import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { R2Env } from '@/lib/r2'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// 50 MB upload cap — matches MAX_VIDEO_BYTES on the client. Defence-in-depth:
// the client also checks, but we never want to trust it.
const MAX_BYTES = 50 * 1024 * 1024

const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/ogg',
  'video/x-m4v',
])

const ALLOWED_POSTER_MIMES = new Set([
  'image/jpeg',
  'image/png',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILENAME_RE = /^[a-z0-9._-]{1,128}$/i

// Direct upload of a video file (or its poster) to the R2 bucket.
// Browser sends a multipart form: { file, albumId, filename, kind }.
// Returns the object's storage_path (R2 key) and the public URL.
//
// Auth model: matches the existing Supabase Storage flow — anyone with the
// album link can upload. We don't require an owner_token because adding
// photos is intentionally guest-friendly. The albumId scopes the key so
// uploads can't write outside their own album folder.
export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400, headers: NO_STORE })
  }

  const file = form.get('file')
  const albumId = String(form.get('albumId') ?? '').trim()
  const filename = String(form.get('filename') ?? '').trim()
  const kind = String(form.get('kind') ?? '').trim()

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400, headers: NO_STORE })
  }
  if (!UUID_RE.test(albumId)) {
    return NextResponse.json({ error: 'Invalid albumId' }, { status: 400, headers: NO_STORE })
  }
  if (!FILENAME_RE.test(filename)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400, headers: NO_STORE })
  }
  if (kind !== 'video' && kind !== 'poster') {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400, headers: NO_STORE })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${MAX_BYTES} byte limit` }, { status: 413, headers: NO_STORE })
  }

  const contentType = file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg')
  const allowed = kind === 'video' ? ALLOWED_VIDEO_MIMES : ALLOWED_POSTER_MIMES
  if (!allowed.has(contentType)) {
    return NextResponse.json({ error: `Unsupported content type: ${contentType}` }, { status: 415, headers: NO_STORE })
  }

  const ctx = getCloudflareContext()
  const env = ctx?.env as R2Env | undefined
  const bucket = env?.R2_VIDEOS
  const publicHost = env?.R2_PUBLIC_HOST ?? process.env.R2_PUBLIC_HOST
  if (!bucket) {
    return NextResponse.json({ error: 'R2 binding not available' }, { status: 500, headers: NO_STORE })
  }
  if (!publicHost) {
    return NextResponse.json({ error: 'R2_PUBLIC_HOST not configured' }, { status: 500, headers: NO_STORE })
  }

  const key = `${albumId}/${filename}`
  try {
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType },
    })
  } catch (e) {
    console.error('[upload/r2] put failed:', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500, headers: NO_STORE })
  }

  const url = `https://${publicHost}/${key}`
  return NextResponse.json({ storage_path: key, url }, { headers: NO_STORE })
}
