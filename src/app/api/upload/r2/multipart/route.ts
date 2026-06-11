import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById } from '@/lib/subscriptions'
import { uploadCapsForTier } from '@/lib/media'
import type { R2Env, R2UploadPart } from '@/lib/r2'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { presignR2UploadPart } from '@/lib/r2-presign'

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
    const { data: ownerRow, error: ownerErr } = await admin
      .from('albums').select('user_id').eq('id', albumId).maybeSingle<{ user_id: string | null }>()
    if (ownerErr) {
      console.error('[upload/r2/multipart] album lookup error:', ownerErr.message, 'albumId:', albumId)
      return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
    }
    if (!ownerRow) {
      console.error('[upload/r2/multipart] album not found for id:', albumId)
      return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
    }
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
      const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } })
      return NextResponse.json({ uploadId: upload.uploadId, key }, { headers: NO_STORE })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[r2/multipart] createMultipartUpload failed:', msg)
      return NextResponse.json({ error: `Failed to init upload: ${msg}` }, { status: 500, headers: NO_STORE })
    }
  }

  // ── presign ───────────────────────────────────────────────────────────────
  // Returns a presigned PUT URL for one multipart part so the browser can upload
  // the chunk bytes directly to R2 — the Worker never sees or buffers the data.
  // Falls back gracefully: if R2 S3 credentials aren't configured, returns 501
  // and the client falls back to the Worker-proxied chunk path.
  if (action === 'presign') {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? ''
    const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? ''
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? ''
    if (!accountId || !accessKeyId || !secretAccessKey) {
      return NextResponse.json({ error: 'R2 presigned URLs not configured' }, { status: 501, headers: NO_STORE })
    }

    let body: { key?: string; uploadId?: string; partNumber?: number }
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE }) }

    const key = String(body.key ?? '').trim()
    const uploadId = String(body.uploadId ?? '').trim()
    const partNumber = Number(body.partNumber)

    if (!KEY_RE.test(key)) return NextResponse.json({ error: 'Invalid key' }, { status: 400, headers: NO_STORE })
    if (!UPLOAD_ID_RE.test(uploadId)) return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400, headers: NO_STORE })
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return NextResponse.json({ error: 'Invalid partNumber' }, { status: 400, headers: NO_STORE })

    try {
      const url = await presignR2UploadPart({ accountId, accessKeyId, secretAccessKey, bucket: 'hushare-videos', key, uploadId, partNumber })
      return NextResponse.json({ url }, { headers: NO_STORE })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[r2/multipart] presign failed:', msg)
      return NextResponse.json({ error: `Presign failed: ${msg}` }, { status: 500, headers: NO_STORE })
    }
  }

  // ── chunk ─────────────────────────────────────────────────────────────────
  // Chunks are sent as raw binary (Content-Type: application/octet-stream).
  // Parameters are passed via query string so the full POST body is the chunk bytes.
  // This is the fallback path when presigned URLs are not configured.
  if (action === 'chunk') {
    const url = new URL(req.url)
    const uploadId = String(url.searchParams.get('uploadId') ?? '').trim()
    const key = String(url.searchParams.get('key') ?? '').trim()
    const partNumber = Number(url.searchParams.get('partNumber'))

    if (!UPLOAD_ID_RE.test(uploadId)) return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400, headers: NO_STORE })
    if (!KEY_RE.test(key)) return NextResponse.json({ error: 'Invalid key' }, { status: 400, headers: NO_STORE })
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return NextResponse.json({ error: 'Invalid partNumber' }, { status: 400, headers: NO_STORE })

    let chunk: ArrayBuffer
    try {
      chunk = await req.arrayBuffer()
    } catch {
      return NextResponse.json({ error: 'Failed to read chunk body' }, { status: 400, headers: NO_STORE })
    }
    if (chunk.byteLength === 0 || chunk.byteLength > CHUNK_MAX) {
      return NextResponse.json({ error: 'Invalid chunk size' }, { status: 413, headers: NO_STORE })
    }

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
