import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clampMediaRadius, clampSlideshowInterval, isMediaDisplayFilter, isMediaHoverEffect, isMobileGridColumns, isSlideshowAnimation, type MediaDisplayFilter, type MediaHoverEffect, type MobileGridColumns, type SlideshowAnimation } from '@/lib/media-display'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: {
    slug?: string
    owner_token?: string
    media_radius?: number
    video_autoplay?: boolean
    media_filter?: MediaDisplayFilter
    media_hover?: MediaHoverEffect
    mobile_grid_columns?: MobileGridColumns
    slideshow_interval_ms?: number
    slideshow_animation?: SlideshowAnimation
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
  const rawMobileGridColumns = body.mobile_grid_columns ?? 3
  const mobileGridColumns = isMobileGridColumns(rawMobileGridColumns) ? Number(rawMobileGridColumns) as MobileGridColumns : null
  const slideshowIntervalMs = clampSlideshowInterval(body.slideshow_interval_ms ?? 4200)
  const rawSlideshowAnimation = body.slideshow_animation ?? 'fade'
  const slideshowAnimation = isSlideshowAnimation(rawSlideshowAnimation) ? rawSlideshowAnimation : null

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
  if (!mobileGridColumns) {
    return NextResponse.json({ error: 'Invalid mobile grid' }, { status: 400, headers: NO_STORE })
  }
  if (slideshowIntervalMs == null) {
    return NextResponse.json({ error: 'Invalid slideshow speed' }, { status: 400, headers: NO_STORE })
  }
  if (!slideshowAnimation) {
    return NextResponse.json({ error: 'Invalid slideshow animation' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyAlbumOwnerAccess(slug, token)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('albums')
    .update({ media_radius: mediaRadius, video_autoplay: videoAutoplay, media_filter: mediaFilter, media_hover: mediaHover, mobile_grid_columns: mobileGridColumns, slideshow_interval_ms: slideshowIntervalMs, slideshow_animation: slideshowAnimation })
    .eq('id', access.album.id)
    .select('media_radius, video_autoplay, media_filter, media_hover, mobile_grid_columns, slideshow_interval_ms, slideshow_animation')
    .single<{ media_radius: number; video_autoplay: boolean; media_filter: MediaDisplayFilter; media_hover: MediaHoverEffect; mobile_grid_columns: MobileGridColumns; slideshow_interval_ms: number; slideshow_animation: SlideshowAnimation }>()

  if (error) {
    console.error('[album/media-settings] update failed:', error.message)
    const migrationMissing =
      error.message.includes('media_radius') ||
      error.message.includes('video_autoplay') ||
      error.message.includes('media_filter') ||
      error.message.includes('media_hover') ||
      error.message.includes('mobile_grid_columns') ||
      error.message.includes('slideshow_interval_ms') ||
      error.message.includes('slideshow_animation') ||
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
      .eq('album_id', access.album.id)

    if (resetError) {
      console.error('[album/media-settings] reset photo overrides failed:', resetError.message)
    }
  }

  return NextResponse.json({ ok: true, ...updated }, { headers: NO_STORE })
}
