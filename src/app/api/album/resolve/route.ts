import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MediaDisplayFilter, MediaHoverEffect, MobileGridColumns, SlideshowAnimation } from '@/lib/media-display'
import { getUserTierById } from '@/lib/subscriptions'
import { cookieNameForAlbum, verifyAccessToken } from '@/lib/album-password'
import { uploadCapsForTier } from '@/lib/media'
import { timingSafeEqual } from '@/lib/timing-safe'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Resolve a URL slug to an album. Three concerns layered together:
//
//   1. Slug type - random slug always resolves; custom slug only resolves
//      while the binding user has Pro+. On downgrade the custom URL silently
//      stops working (per the pricing FAQ).
//
//   2. Password gate - if the album has a password set AND the owner is
//      Pro+, we return only minimal info (`{ album: null, password_required:
//      true, summary: { id, title } }`) unless the per-album cookie proves
//      the password has already been entered. The owner token does not skip
//      this gate; after unlock, the same URL still enables owner settings.
//
//   3. Safety - never return owner_token, password_hash, or user_id to the
//      browser. The internal lookup needs them; the response shape filters.
type FullAlbum = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  description: string | null
  background_theme: string | null
  media_radius?: number | null
  video_autoplay?: boolean | null
  media_filter?: MediaDisplayFilter | null
  media_hover?: MediaHoverEffect | null
  mobile_grid_columns?: MobileGridColumns | null
  slideshow_interval_ms?: number | null
  slideshow_animation?: SlideshowAnimation | null
  cover_photo_id: string | null
  reveal_at: string | null
  created_at: string
  retired_at: string | null
  user_id: string | null
  owner_token: string
  password_hash: string | null
  allow_guest_downloads: boolean
}

type PublicAlbum = Omit<FullAlbum, 'user_id' | 'owner_token' | 'password_hash' | 'retired_at'>

const SELECT_COLUMNS = 'id, slug, custom_slug, title, description, background_theme, media_radius, video_autoplay, media_filter, media_hover, mobile_grid_columns, slideshow_interval_ms, slideshow_animation, cover_photo_id, reveal_at, created_at, retired_at, user_id, owner_token, password_hash, allow_guest_downloads'
const LEGACY_SELECT_COLUMNS = 'id, slug, custom_slug, title, description, background_theme, created_at, retired_at, user_id, owner_token, password_hash'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const slug = (searchParams.get('slug') ?? '').trim()
  // owner_token is read from the HttpOnly cookie set by /api/album/owner-login,
  // not from the URL — tokens in query params leak to logs and Referer headers.
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  // Prevent slug enumeration: limits resolution attempts per IP.
  const rl = await checkRateLimit(clientIpKey(req, 'album_resolve'), 60, 30, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const admin = createAdminClient()

  // Random-slug lookup first. The vast majority of URLs hit this branch.
  const byRandom = await lookupAlbum(admin, 'slug', slug)

  if (byRandom) {
    if (byRandom.retired_at) {
      return NextResponse.json({ album: null }, { status: 404, headers: NO_STORE })
    }
    return await buildResponse(byRandom)
  }

  // Custom-slug lookup. Tier-gated.
  const byCustom = await lookupAlbum(admin, 'custom_slug', slug)

  if (!byCustom) {
    return NextResponse.json({ album: null }, { status: 404, headers: NO_STORE })
  }
  if (byCustom.retired_at) {
    return NextResponse.json({ album: null }, { status: 404, headers: NO_STORE })
  }

  const tier = await getUserTierById(byCustom.user_id)
  if (tier === 'free') {
    // Intentional: return the same { album: null } 404 as "slug never existed"
    // to prevent subscription-status enumeration. Do not add a different body
    // or status code here.
    return NextResponse.json({ album: null }, { status: 404, headers: NO_STORE })
  }

  // Pass the already-fetched tier so buildResponse doesn't make a second DB call.
  return await buildResponse(byCustom, tier)
}

async function buildResponse(album: FullAlbum, cachedTier?: Awaited<ReturnType<typeof getUserTierById>>) {
  // Owner tier drives both the upload cap returned to the client AND the
  // password-enforcement decision. Use the cached value when available (custom-slug
  // path already fetched it) to save a DB round-trip on every album load.
  const ownerTier = cachedTier ?? await getUserTierById(album.user_id)
  const upload_caps = uploadCapsForTier(ownerTier)

  // Once a password exists, enforce it regardless of the owner's current tier.
  // Downgrading a paid account must not silently expose a protected album.
  const passwordEnforced = !!album.password_hash

  if (passwordEnforced) {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(cookieNameForAlbum(album.id))?.value
    const verified = cookie != null && await verifyAccessToken(cookie, album.password_hash, album.id)

    if (!verified) {
      return NextResponse.json(
        {
          album: null,
          password_required: true,
          summary: { id: album.id, slug: album.slug, title: album.title },
        },
        { headers: NO_STORE },
      )
    }
  }

  // Read the owner token from the HttpOnly cookie (set by /api/album/owner-login).
  // Always call timingSafeEqual — no ternary short-circuit that leaks token presence via timing.
  const cookieStore = await cookies()
  const ownerCookie = (cookieStore.get(`hushare_owner_${album.id}`)?.value ?? '').trim()
  const hasValidOwnerToken = timingSafeEqual(ownerCookie, album.owner_token)

  // Reveal gate — guests see a countdown until reveal_at; verified owners bypass it.
  if (album.reveal_at && !hasValidOwnerToken && new Date(album.reveal_at) > new Date()) {
    return NextResponse.json(
      {
        album: null,
        reveal_at: album.reveal_at,
        summary: { id: album.id, slug: album.slug, title: album.title },
      },
      { headers: NO_STORE },
    )
  }

  // password_protected is intentionally omitted from the public response.
  // Guests who need to know a password is required will receive { password_required: true }
  // from the gate above. Exposing the boolean to all callers leaks album security posture
  // and aids enumeration of which albums are worth attacking.
  const safe: PublicAlbum & { upload_caps: typeof upload_caps; reveal_at: string | null; face_finder_enabled: boolean } = {
    id: album.id,
    slug: album.slug,
    custom_slug: album.custom_slug,
    title: album.title,
    description: album.description,
    background_theme: album.background_theme,
    media_radius: album.media_radius ?? 12,
    video_autoplay: album.video_autoplay !== false, // null = on by default
    media_filter: album.media_filter ?? 'none',
    media_hover: album.media_hover ?? 'none',
    mobile_grid_columns: album.mobile_grid_columns ?? 3,
    slideshow_interval_ms: album.slideshow_interval_ms ?? 4200,
    slideshow_animation: album.slideshow_animation ?? 'fade',
    cover_photo_id: album.cover_photo_id ?? null,
    reveal_at: album.reveal_at ?? null,
    face_finder_enabled: ownerTier === 'studio',
    allow_guest_downloads: album.allow_guest_downloads ?? true,
    created_at: album.created_at,
    upload_caps,
  }
  // Fire-and-forget — the response shouldn't wait on this best-effort DB write.
  void touchAlbumActivity(album.id)
  return NextResponse.json({ album: safe }, { headers: NO_STORE })
}

async function lookupAlbum(
  admin: ReturnType<typeof createAdminClient>,
  column: 'slug' | 'custom_slug',
  value: string,
): Promise<FullAlbum | null> {
  const { data, error } = await admin
    .from('albums')
    .select(SELECT_COLUMNS)
    .eq(column, value)
    .maybeSingle<FullAlbum>()

  if (data || !error) return data ?? null

  // Backward compatibility for deployments where the app has updated before
  // the media display migration has reached Supabase.
  if (error.message.includes('media_radius') || error.message.includes('video_autoplay') || error.message.includes('media_filter') || error.message.includes('media_hover') || error.message.includes('mobile_grid_columns') || error.message.includes('slideshow_interval_ms') || error.message.includes('slideshow_animation') || error.message.includes('allow_guest_downloads')) {
    console.warn('[album/resolve] media settings columns missing; using legacy album projection')
    const { data: legacy, error: legacyError } = await admin
      .from('albums')
      .select(LEGACY_SELECT_COLUMNS)
      .eq(column, value)
      .maybeSingle<Omit<FullAlbum, 'media_radius' | 'video_autoplay' | 'media_filter' | 'media_hover' | 'mobile_grid_columns' | 'slideshow_interval_ms' | 'slideshow_animation'>>()
    if (legacyError) {
      console.error('[album/resolve] legacy album lookup failed:', legacyError.message)
      return null
    }
    return legacy ? { ...legacy, cover_photo_id: null, media_radius: 12, video_autoplay: true, media_filter: 'none', media_hover: 'none', mobile_grid_columns: 3, slideshow_interval_ms: 4200, slideshow_animation: 'fade', reveal_at: null, allow_guest_downloads: true } : null
  }

  console.error('[album/resolve] album lookup failed:', error.message)
  return null
}

async function touchAlbumActivity(albumId: string) {
  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('albums')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', albumId)
    if (error) console.error('[album/resolve] activity touch failed:', error.message)
  } catch (err) {
    // Swallow — this runs detached from the response so an unhandled rejection would just log.
    console.error('[album/resolve] activity touch threw:', err instanceof Error ? err.message : String(err))
  }
}
