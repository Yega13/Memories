import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clampMediaRadius, isMediaDisplayFilter, isMediaHoverEffect, type MediaDisplayFilter, type MediaHoverEffect } from '@/lib/media-display'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  let body: {
    slug?: string
    owner_token?: string
    media_radius?: number
    video_autoplay?: boolean
    media_filter?: MediaDisplayFilter
    media_hover?: MediaHoverEffect
    reset_radius_overrides?: boolean
    reset_filter_overrides?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const mediaRadius = clampMediaRadius(body.media_radius)
  const videoAutoplay = Boolean(body.video_autoplay)
  const rawMediaFilter = body.media_filter ?? 'none'
  const mediaFilter = isMediaDisplayFilter(rawMediaFilter) ? rawMediaFilter : null
  const rawMediaHover = body.media_hover ?? 'none'
  const mediaHover = isMediaHoverEffect(rawMediaHover) ? rawMediaHover : null

  if (!slug || !token) {
    return NextResponse.json({ error: 'Missing slug or owner_token' }, { status: 400, headers: NO_STORE })
  }
  if (mediaRadius == null) {
    return NextResponse.json({ error: 'Invalid border radius' }, { status: 400, headers: NO_STORE })
  }
  if (!mediaFilter) {
    return NextResponse.json({ error: 'Invalid filter' }, { status: 400, headers: NO_STORE })
  }
  if (!mediaHover) {
    return NextResponse.json({ error: 'Invalid hover effect' }, { status: 400, headers: NO_STORE })
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
    .update({ media_radius: mediaRadius, video_autoplay: videoAutoplay, media_filter: mediaFilter, media_hover: mediaHover })
    .eq('id', album.id)
    .select('media_radius, video_autoplay, media_filter, media_hover')
    .single<{ media_radius: number; video_autoplay: boolean; media_filter: MediaDisplayFilter; media_hover: MediaHoverEffect }>()

  if (error) {
    console.error('[album/media-settings] update failed:', error.message)
    const migrationMissing =
      error.message.includes('media_radius') ||
      error.message.includes('video_autoplay') ||
      error.message.includes('media_filter') ||
      error.message.includes('media_hover') ||
      error.message.includes('schema cache')
    return NextResponse.json(
      {
        error: migrationMissing
          ? 'Database media settings migration is not applied yet.'
          : 'Could not save media settings',
      },
      { status: 500, headers: NO_STORE },
    )
  }

  const resetPatch: { display_radius?: null; display_filter?: null } = {}
  if (body.reset_radius_overrides) resetPatch.display_radius = null
  if (body.reset_filter_overrides) resetPatch.display_filter = null

  if (Object.keys(resetPatch).length > 0) {
    const { error: resetError } = await admin
      .from('photos')
      .update(resetPatch)
      .eq('album_id', album.id)

    if (resetError) {
      console.error('[album/media-settings] reset photo overrides failed:', resetError.message)
    }
  }

  return NextResponse.json({ ok: true, ...updated }, { headers: NO_STORE })
}
