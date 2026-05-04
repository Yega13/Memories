import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MIN_RADIUS = 0
const MAX_RADIUS = 36

export async function POST(req: Request) {
  let body: { slug?: string; owner_token?: string; media_radius?: number; video_autoplay?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const mediaRadius = clampRadius(body.media_radius)
  const videoAutoplay = Boolean(body.video_autoplay)

  if (!slug || !token) {
    return NextResponse.json({ error: 'Missing slug or owner_token' }, { status: 400, headers: NO_STORE })
  }
  if (mediaRadius == null) {
    return NextResponse.json({ error: 'Invalid border radius' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album, error: lookupError } = await admin
    .from('albums')
    .select('id, owner_token')
    .eq('slug', slug)
    .maybeSingle<{ id: string; owner_token: string }>()

  if (lookupError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!timingSafeEqual(token, album.owner_token)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const { data: updated, error } = await admin
    .from('albums')
    .update({ media_radius: mediaRadius, video_autoplay: videoAutoplay })
    .eq('id', album.id)
    .select('media_radius, video_autoplay')
    .single<{ media_radius: number; video_autoplay: boolean }>()

  if (error) {
    console.error('[album/media-settings] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save media settings' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, ...updated }, { headers: NO_STORE })
}

function clampRadius(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(numeric)))
}
