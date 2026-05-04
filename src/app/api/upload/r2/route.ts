import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById } from '@/lib/subscriptions'
import { uploadCapsForTier, PRO_VIDEO_BYTES } from '@/lib/media'
import type { R2Env } from '@/lib/r2'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Absolute ceiling regardless of tier - protects against any future bug
// that raises caps unintentionally. Currently matches the Pro/Studio cap.
const HARD_MAX_BYTES = PRO_VIDEO_BYTES

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
// Auth model: matches the existing Supabase Storage flow - anyone with the
// album link can upload. We don't require an owner_token because adding
// photos is intentionally guest-friendly. The albumId scopes the key so
// uploads can't write outside their own album folder.
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

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

  // Reject anything over the absolute ceiling before we touch the DB.
  if (file.size > HARD_MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${HARD_MAX_BYTES} byte limit` },
      { status: 413, headers: NO_STORE },
    )
  }

  // Tier-aware per-album cap. The owner's tier dictates the cap for every
  // uploader on the album. Anonymous albums (no user_id) get the free cap.
  const admin = createAdminClient()
  const { data: ownerRow } = await admin
    .from('albums')
    .select('user_id')
    .eq('id', albumId)
    .maybeSingle<{ user_id: string | null }>()
  if (!ownerRow) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  const ownerTier = await getUserTierById(ownerRow.user_id)
  const caps = uploadCapsForTier(ownerTier)
  // Posters are auto-generated thumbnails - they ride alongside videos
  // and are tiny in practice, so the video cap is the natural ceiling for
  // both. No separate poster limit needed.
  if (file.size > caps.video) {
    return NextResponse.json(
      { error: `File exceeds the ${caps.video}-byte limit for this album` },
      { status: 413, headers: NO_STORE },
    )
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
