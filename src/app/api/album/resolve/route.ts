import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MediaDisplayFilter, MediaHoverEffect } from '@/lib/media-display'
import { getUserTierById } from '@/lib/subscriptions'
import { cookieNameForAlbum, deriveAccessToken } from '@/lib/album-password'
import { uploadCapsForTier } from '@/lib/media'
import { timingSafeEqual } from '@/lib/timing-safe'

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
//      true, summary: { id, title } }`) unless the visitor's per-album cookie
//      proves they've already entered the password. The owner's flow is
//      handled separately via the `?owner=` query param on the page.
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
  created_at: string
  retired_at: string | null
  user_id: string | null
  password_hash: string | null
}

type PublicAlbum = Omit<FullAlbum, 'user_id' | 'password_hash' | 'retired_at'>

const SELECT_COLUMNS = 'id, slug, custom_slug, title, description, background_theme, media_radius, video_autoplay, media_filter, media_hover, created_at, retired_at, user_id, password_hash'
const LEGACY_SELECT_COLUMNS = 'id, slug, custom_slug, title, description, background_theme, created_at, retired_at, user_id, password_hash'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const slug = (searchParams.get('slug') ?? '').trim()
  // Owners pass their owner_token along so the resolver can skip the
  // password gate for them. Same trust model as the rest of the site -
  // whoever holds the token is the owner.
  const ownerToken = (searchParams.get('owner_token') ?? '').trim()
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // Random-slug lookup first. The vast majority of URLs hit this branch.
  const byRandom = await lookupAlbum(admin, 'slug', slug)

  if (byRandom) {
    if (byRandom.retired_at) {
      return NextResponse.json({ album: null }, { status: 404, headers: NO_STORE })
    }
    return await buildResponse(byRandom, ownerToken)
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
    return NextResponse.json({ album: null }, { status: 404, headers: NO_STORE })
  }

  return await buildResponse(byCustom, ownerToken)
}

async function buildResponse(album: FullAlbum, ownerToken: string) {
  // We need owner_token internally for two reasons: (1) timing-safe compare
  // to short-circuit the password gate for the owner, (2) ensuring we don't
  // leak it back to the caller. Re-fetch it through the same admin client
  // so we don't have to add it to SELECT_COLUMNS (which is shared with the
  // public projection and shouldn't grow).
  const ownerMatches =
    ownerToken.length > 0 &&
    (await ownerTokenMatches(album.id, ownerToken))

  // Owner tier drives both the upload cap returned to the client AND the
  // password-enforcement decision. Compute it once.
  const ownerTier = await getUserTierById(album.user_id)
  const upload_caps = uploadCapsForTier(ownerTier)

  // Password enforcement is conditional on the OWNER's tier - if they've
  // lapsed below Pro, the password "is removed" (per the FAQ promise) and
  // the album becomes openly viewable again. We still keep the hash on the
  // row so re-upgrading restores it.
  let passwordEnforced = false
  if (album.password_hash && !ownerMatches && ownerTier !== 'free') {
    passwordEnforced = true
  }

  if (passwordEnforced && album.password_hash) {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(cookieNameForAlbum(album.id))?.value
    const expectedToken = await deriveAccessToken(album.password_hash, album.id)
    const verified = cookie != null && timingSafeEqual(cookie, expectedToken)

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

  const safe: PublicAlbum & { password_protected: boolean; upload_caps: typeof upload_caps } = {
    id: album.id,
    slug: album.slug,
    custom_slug: album.custom_slug,
    title: album.title,
    description: album.description,
    background_theme: album.background_theme,
    media_radius: album.media_radius ?? 12,
    video_autoplay: !!album.video_autoplay,
    media_filter: album.media_filter ?? 'none',
    media_hover: album.media_hover ?? 'none',
    created_at: album.created_at,
    password_protected: !!album.password_hash,
    upload_caps,
  }
  await touchAlbumActivity(album.id)
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
  if (error.message.includes('media_radius') || error.message.includes('video_autoplay') || error.message.includes('media_filter') || error.message.includes('media_hover')) {
    console.warn('[album/resolve] media settings columns missing; using legacy album projection')
    const { data: legacy, error: legacyError } = await admin
      .from('albums')
      .select(LEGACY_SELECT_COLUMNS)
      .eq(column, value)
      .maybeSingle<Omit<FullAlbum, 'media_radius' | 'video_autoplay' | 'media_filter' | 'media_hover'>>()
    if (legacyError) {
      console.error('[album/resolve] legacy album lookup failed:', legacyError.message)
      return null
    }
    return legacy ? { ...legacy, media_radius: 12, video_autoplay: false, media_filter: 'none', media_hover: 'none' } : null
  }

  console.error('[album/resolve] album lookup failed:', error.message)
  return null
}

async function touchAlbumActivity(albumId: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('albums')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', albumId)
  if (error) console.error('[album/resolve] activity touch failed:', error.message)
}

async function ownerTokenMatches(albumId: string, supplied: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('albums')
    .select('owner_token')
    .eq('id', albumId)
    .maybeSingle<{ owner_token: string }>()
  if (!data) return false
  return timingSafeEqual(supplied, data.owner_token)
}
