import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { generateR2PresignedPut, r2PresignConfigured } from '@/lib/r2-presign'
import { uploadCapsForTier, PRO_VIDEO_BYTES } from '@/lib/media'
import { getUserTierById } from '@/lib/subscriptions'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const HARD_MAX_BYTES = PRO_VIDEO_BYTES

const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/ogg',
  'video/x-m4v',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILENAME_RE = /^[a-z0-9._-]{1,128}$/i

// Returns a presigned PUT URL so the browser can upload large videos
// directly to R2 without going through the Worker (bypasses 100 MB body limit).
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  if (!r2PresignConfigured()) {
    return NextResponse.json(
      { error: 'Large video uploads not configured yet' },
      { status: 503, headers: NO_STORE },
    )
  }

  let body: { albumId?: string; filename?: string; contentType?: string; size?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE })
  }

  const albumId = String(body.albumId ?? '').trim()
  const filename = String(body.filename ?? '').trim()
  const contentType = String(body.contentType ?? '').trim()
  const size = Number(body.size ?? 0)

  if (!UUID_RE.test(albumId)) {
    return NextResponse.json({ error: 'Invalid albumId' }, { status: 400, headers: NO_STORE })
  }
  if (!FILENAME_RE.test(filename)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400, headers: NO_STORE })
  }
  if (!ALLOWED_VIDEO_MIMES.has(contentType)) {
    return NextResponse.json({ error: 'Unsupported video type' }, { status: 415, headers: NO_STORE })
  }
  if (size > HARD_MAX_BYTES) {
    return NextResponse.json(
      { error: `Video too large (max ${Math.round(HARD_MAX_BYTES / 1024 / 1024)} MB)` },
      { status: 413, headers: NO_STORE },
    )
  }

  const admin = createAdminClient()

  // Verify album exists
  const { data: album } = await admin
    .from('albums')
    .select('id, user_id')
    .eq('id', albumId)
    .maybeSingle<{ id: string; user_id: string | null }>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  // Check tier cap if album has an owner
  if (album.user_id) {
    try {
      const tier = await getUserTierById(album.user_id)
      const caps = uploadCapsForTier(tier)
      if (size > caps.video) {
        return NextResponse.json(
          { error: `Video too large for your plan (max ${Math.round(caps.video / 1024 / 1024)} MB)` },
          { status: 413, headers: NO_STORE },
        )
      }
    } catch {
      // tier check failed — allow upload (don't block guests)
    }
  }

  const objectKey = `${albumId}/${filename}`
  const publicUrl = `https://${process.env.R2_PUBLIC_HOST ?? 'videos.hushare.space'}/${objectKey}`

  const presignedUrl = await generateR2PresignedPut(objectKey, contentType)

  return NextResponse.json(
    { presignedUrl, storage_path: objectKey, url: publicUrl },
    { headers: NO_STORE },
  )
}
