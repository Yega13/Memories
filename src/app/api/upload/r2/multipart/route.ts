import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById } from '@/lib/subscriptions'
import { uploadCapsForTier } from '@/lib/media'
import type { R2Env, R2UploadPart } from '@/lib/r2'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'
// Long videos on slow mobile data: a single chunk PUT can take a couple of minutes. Give the
// route headroom past the default Next.js maxDuration so the chunk upload finishes cleanly.
export const maxDuration = 120

const NO_STORE = { 'Cache-Control': 'no-store' }

// Each chunk must stay under Cloudflare's 100 MB body limit.
const CHUNK_MAX = 95 * 1024 * 1024

const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/ogg', 'video/x-m4v',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILENAME_RE = /^[a-z0-9._-]{1,128}$/i
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9._-]{1,128}$/i
const UPLOAD_ID_RE = /^[\w+/=_-]{1,512}$/

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const ctx = getCloudflareContext()
  const env = ctx?.env as R2Env | undefined
  const bucket = env?.R2_VIDEOS
  const publicHost = env?.R2_PUBLIC_HOST ?? process.env.R2_PUBLIC_HOST
  if (!bucket) return NextResponse.json({ error: 'R2 binding not available' }, { status: 500, headers: NO_STORE })
  if (!publicHost) return NextResponse.json({ error: 'R2_PUBLIC_HOST not configured' }, { status: 500, headers: NO_STORE })

  const action = new URL(req.url).searchParams.get('action')

  // ── init ──────────────────────────────────────────────────────────────────
  if (action === 'init') {
    let body: { albumId?: string; filename?: string; contentType?: string; totalSize?: number }
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE }) }

    const albumId = String(body.albumId ?? '').trim()
    const filename = String(body.filename ?? '').trim()
    const contentType = String(body.contentType ?? 'video/mp4').trim()
    const totalSize = Number(body.totalSize ?? 0)

    if (!UUID_RE.test(albumId)) return NextResponse.json({ error: 'Invalid albumId' }, { status: 400, headers: NO_STORE })
    if (!FILENAME_RE.test(filename)) return NextResponse.json({ error: 'Invalid filename' }, { status: 400, headers: NO_STORE })
    if (!ALLOWED_VIDEO_MIMES.has(contentType)) return NextResponse.json({ error: 'Unsupported content type' }, { status: 415, headers: NO_STORE })

    // Tier-aware size cap
    const admin = createAdminClient()
    const { data: ownerRow } = await admin
      .from('albums').select('user_id').eq('id', albumId).maybeSingle<{ user_id: string | null }>()
    if (!ownerRow) return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
    const tier = await getUserTierById(ownerRow.user_id)
    const caps = uploadCapsForTier(tier)
    if (totalSize > caps.video) {
      return NextResponse.json(
        { error: `File exceeds the ${caps.video}-byte limit for this album` },
        { status: 413, headers: NO_STORE },
      )
    }

    const key = `${albumId}/${filename}`
    const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType } })
    return NextResponse.json({ uploadId: upload.uploadId, key }, { headers: NO_STORE })
  }

  // ── chunk ─────────────────────────────────────────────────────────────────
  if (action === 'chunk') {
    // Switched from FormData (which buffers the whole 50 MB chunk into memory before we even
    // see it) to raw body + query-param metadata. R2's uploadPart accepts the request stream
    // directly, so we never hold the full chunk in Worker memory.
    const url = new URL(req.url)
    const uploadId = (url.searchParams.get('uploadId') ?? '').trim()
    const key = (url.searchParams.get('key') ?? '').trim()
    const partNumber = Number(url.searchParams.get('partNumber'))
    const contentLengthHeader = req.headers.get('content-length')
    const declaredSize = contentLengthHeader ? Number(contentLengthHeader) : NaN

    if (!UPLOAD_ID_RE.test(uploadId)) return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400, headers: NO_STORE })
    if (!KEY_RE.test(key)) return NextResponse.json({ error: 'Invalid key' }, { status: 400, headers: NO_STORE })
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return NextResponse.json({ error: 'Invalid partNumber' }, { status: 400, headers: NO_STORE })
    if (!req.body) return NextResponse.json({ error: 'Missing chunk body' }, { status: 400, headers: NO_STORE })
    if (Number.isFinite(declaredSize) && declaredSize > CHUNK_MAX) return NextResponse.json({ error: 'Chunk too large' }, { status: 413, headers: NO_STORE })

    try {
      const upload = bucket.resumeMultipartUpload(key, uploadId)
      const part = await upload.uploadPart(partNumber, req.body)
      return NextResponse.json({ partNumber: part.partNumber, etag: part.etag }, { headers: NO_STORE })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[r2/multipart] chunk upload failed:', msg, 'part', partNumber, 'key', key)
      return NextResponse.json({ error: `Chunk ${partNumber} failed: ${msg}` }, { status: 500, headers: NO_STORE })
    }
  }

  // ── complete ──────────────────────────────────────────────────────────────
  if (action === 'complete') {
    let body: { uploadId?: string; key?: string; parts?: R2UploadPart[] }
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE }) }

    const uploadId = String(body.uploadId ?? '').trim()
    const key = String(body.key ?? '').trim()
    const parts = body.parts

    if (!UPLOAD_ID_RE.test(uploadId)) return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400, headers: NO_STORE })
    if (!KEY_RE.test(key)) return NextResponse.json({ error: 'Invalid key' }, { status: 400, headers: NO_STORE })
    if (!Array.isArray(parts) || parts.length === 0) return NextResponse.json({ error: 'Invalid parts' }, { status: 400, headers: NO_STORE })

    const upload = bucket.resumeMultipartUpload(key, uploadId)
    await upload.complete(parts)
    return NextResponse.json({ storage_path: key, url: `https://${publicHost}/${key}` }, { headers: NO_STORE })
  }

  // ── abort ─────────────────────────────────────────────────────────────────
  if (action === 'abort') {
    let body: { uploadId?: string; key?: string }
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE }) }

    const uploadId = String(body.uploadId ?? '').trim()
    const key = String(body.key ?? '').trim()

    if (!UPLOAD_ID_RE.test(uploadId)) return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400, headers: NO_STORE })
    if (!KEY_RE.test(key)) return NextResponse.json({ error: 'Invalid key' }, { status: 400, headers: NO_STORE })

    const upload = bucket.resumeMultipartUpload(key, uploadId)
    await upload.abort()
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: NO_STORE })
}
