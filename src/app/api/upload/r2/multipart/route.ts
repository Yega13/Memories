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
export const maxDuration = 300

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
    try {
      const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType } })
      return NextResponse.json({ uploadId: upload.uploadId, key }, { headers: NO_STORE })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[r2/multipart] createMultipartUpload failed:', msg)
      return NextResponse.json({ error: `Failed to init upload: ${msg}` }, { status: 500, headers: NO_STORE })
    }
  }

  // ── chunk ─────────────────────────────────────────────────────────────────
  if (action === 'chunk') {
    const contentType = req.headers.get('content-type') ?? ''
    let uploadId = ''
    let key = ''
    let partNumber = 0
    let chunk: Blob | ArrayBuffer

    if (contentType.includes('multipart/form-data')) {
      let form: FormData
      try { form = await req.formData() } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400, headers: NO_STORE }) }
      uploadId = String(form.get('uploadId') ?? '').trim()
      key = String(form.get('key') ?? '').trim()
      partNumber = Number(form.get('partNumber'))
      const formChunk = form.get('chunk')
      if (!(formChunk instanceof Blob)) return NextResponse.json({ error: 'Missing chunk' }, { status: 400, headers: NO_STORE })
      chunk = formChunk
    } else {
      const url = new URL(req.url)
      uploadId = String(url.searchParams.get('uploadId') ?? '').trim()
      key = String(url.searchParams.get('key') ?? '').trim()
      partNumber = Number(url.searchParams.get('partNumber'))
      const contentLengthHeader = req.headers.get('content-length')
      const declaredSize = contentLengthHeader ? Number(contentLengthHeader) : NaN
      if (Number.isFinite(declaredSize) && declaredSize > CHUNK_MAX) return NextResponse.json({ error: 'Chunk too large' }, { status: 413, headers: NO_STORE })
      try { chunk = await req.arrayBuffer() } catch { return NextResponse.json({ error: 'Invalid chunk body' }, { status: 400, headers: NO_STORE }) }
    }

    if (!UPLOAD_ID_RE.test(uploadId)) return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400, headers: NO_STORE })
    if (!KEY_RE.test(key)) return NextResponse.json({ error: 'Invalid key' }, { status: 400, headers: NO_STORE })
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return NextResponse.json({ error: 'Invalid partNumber' }, { status: 400, headers: NO_STORE })
    const chunkSize = chunk instanceof Blob ? chunk.size : chunk.byteLength
    if (chunkSize <= 0) return NextResponse.json({ error: 'Missing chunk' }, { status: 400, headers: NO_STORE })
    if (chunkSize > CHUNK_MAX) return NextResponse.json({ error: 'Chunk too large' }, { status: 413, headers: NO_STORE })

    try {
      const upload = bucket.resumeMultipartUpload(key, uploadId)
      const part = await upload.uploadPart(partNumber, chunk)
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

    try {
      const upload = bucket.resumeMultipartUpload(key, uploadId)
      await upload.complete(parts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[r2/multipart] complete failed:', msg, 'key', key)
      return NextResponse.json({ error: `Upload complete failed: ${msg}` }, { status: 500, headers: NO_STORE })
    }
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

    try {
      const upload = bucket.resumeMultipartUpload(key, uploadId)
      await upload.abort()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[r2/multipart] abort failed:', msg, 'key', key)
      return NextResponse.json({ error: `Abort failed: ${msg}` }, { status: 500, headers: NO_STORE })
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: NO_STORE })
}
