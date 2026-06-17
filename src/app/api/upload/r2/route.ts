import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById } from '@/lib/subscriptions'
import { uploadCapsForTier, PRO_IMAGE_BYTES, PRO_VIDEO_BYTES } from '@/lib/media'
import type { R2Env } from '@/lib/r2'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyMimeByMagic } from '@/lib/file-magic'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 300

const NO_STORE = { 'Cache-Control': 'no-store' }

// Absolute ceiling per kind — protects against any future bug that raises caps unintentionally.
const HARD_MAX_BYTES: Record<string, number> = {
  video: PRO_VIDEO_BYTES,
  poster: PRO_IMAGE_BYTES,
  image: PRO_IMAGE_BYTES,
}

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

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILENAME_RE = /^[a-z0-9._-]{1,128}$/i

// Direct upload of a video file, poster, or image to the R2 bucket.
// Browser sends a multipart form: { file, albumId, filename, kind }.
// Returns the object's storage_path (R2 key) and the public URL.
//
// Auth model: matches the existing Supabase Storage flow - anyone with the
// album link can upload. We don't require an owner_token because adding
// photos is intentionally guest-friendly. The albumId scopes the key so
// uploads can't write outside their own album folder.
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  // Per-IP rate limit: 500 uploads/hour prevents a single source from flooding storage.
  const ipLimit = await checkRateLimit(clientIpKey(req, 'r2_upload'), 3600, 500, { failOpen: true })
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: 'Upload limit reached. Please wait before uploading more files.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfterSeconds) } },
    )
  }

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
  if (kind !== 'video' && kind !== 'poster' && kind !== 'image') {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400, headers: NO_STORE })
  }

  // Reject anything over the absolute ceiling before we touch the DB.
  const hardMax = HARD_MAX_BYTES[kind] ?? PRO_VIDEO_BYTES
  if (file.size > hardMax) {
    return NextResponse.json(
      { error: `File exceeds ${hardMax} byte limit` },
      { status: 413, headers: NO_STORE },
    )
  }

  // Album rate-limit check and DB owner lookup are independent — run in parallel
  // to cut one sequential Supabase round-trip off every upload.
  const admin = createAdminClient()
  const [albumLimit, ownerResult] = await Promise.all([
    checkRateLimit(`r2_upload_album:${albumId}`, 3600, 5000, { failOpen: true }),
    admin
      .from('albums')
      .select('user_id')
      .eq('id', albumId)
      .maybeSingle<{ user_id: string | null }>(),
  ])

  if (!albumLimit.ok) {
    return NextResponse.json(
      { error: 'This album has reached its upload limit. Please try again later.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(albumLimit.retryAfterSeconds) } },
    )
  }

  const { data: ownerRow, error: ownerErr } = ownerResult
  if (ownerErr) {
    console.error('[upload/r2] album lookup error — code:', ownerErr.code, 'msg:', ownerErr.message, 'albumId:', albumId)
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!ownerRow) {
    console.error('[upload/r2] album not found in DB — albumId:', albumId)
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  const contentType = file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg')
  const allowed = kind === 'video' ? ALLOWED_VIDEO_MIMES : kind === 'image' ? ALLOWED_IMAGE_MIMES : ALLOWED_POSTER_MIMES
  if (!allowed.has(contentType)) {
    return NextResponse.json({ error: `Unsupported content type: ${contentType}` }, { status: 415, headers: NO_STORE })
  }

  // Tier lookup (up to 2 Supabase calls for free users) and magic-byte check
  // are independent — run in parallel to cut another sequential round-trip.
  const [ownerTier, magicOk] = await Promise.all([
    getUserTierById(ownerRow.user_id),
    verifyMimeByMagic(file, contentType),
  ])

  if (!magicOk) {
    return NextResponse.json({ error: 'File content does not match declared type' }, { status: 415, headers: NO_STORE })
  }

  const caps = uploadCapsForTier(ownerTier)
  // Images use the image cap; posters ride alongside videos so use the video cap.
  const sizeCap = kind === 'image' ? caps.image : caps.video
  if (file.size > sizeCap) {
    return NextResponse.json(
      { error: `File exceeds the ${sizeCap}-byte limit for this album` },
      { status: 413, headers: NO_STORE },
    )
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

  const randomPrefix = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const key = `${albumId}/${randomPrefix}/${filename}`
  try {
    // Pass the Blob directly — avoids buffering the whole file into an ArrayBuffer
    // inside the Worker, which would hit the 128 MB memory limit for large videos.
    await bucket.put(key, file, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
    })
  } catch (e) {
    console.error('[upload/r2] put failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Upload failed' }, { status: 500, headers: NO_STORE })
  }

  const url = `https://${publicHost}/${key}`
  return NextResponse.json({ storage_path: key, url }, { headers: NO_STORE })
}
