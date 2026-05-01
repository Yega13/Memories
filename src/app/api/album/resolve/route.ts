import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById } from '@/lib/subscriptions'
import { cookieNameForAlbum, deriveAccessToken } from '@/lib/album-password'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Resolve a URL slug to an album. Three concerns layered together:
//
//   1. Slug type — random slug always resolves; custom slug only resolves
//      while the binding user has Pro+. On downgrade the custom URL silently
//      stops working (per the pricing FAQ).
//
//   2. Password gate — if the album has a password set AND the owner is
//      Pro+, we return only minimal info (`{ album: null, password_required:
//      true, summary: { id, title } }`) unless the visitor's per-album cookie
//      proves they've already entered the password. The owner's flow is
//      handled separately via the `?owner=` query param on the page.
//
//   3. Safety — never return owner_token, password_hash, or user_id to the
//      browser. The internal lookup needs them; the response shape filters.
type FullAlbum = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  description: string | null
  created_at: string
  user_id: string | null
  password_hash: string | null
}

type PublicAlbum = Omit<FullAlbum, 'user_id' | 'password_hash'>

const SELECT_COLUMNS = 'id, slug, custom_slug, title, description, created_at, user_id, password_hash'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const slug = (searchParams.get('slug') ?? '').trim()
  // Owners pass their owner_token along so the resolver can skip the
  // password gate for them. Same trust model as the rest of the site —
  // whoever holds the token is the owner.
  const ownerToken = (searchParams.get('owner_token') ?? '').trim()
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // Random-slug lookup first. The vast majority of URLs hit this branch.
  const { data: byRandom } = await admin
    .from('albums')
    .select(SELECT_COLUMNS)
    .eq('slug', slug)
    .maybeSingle<FullAlbum>()

  if (byRandom) {
    return await buildResponse(byRandom, ownerToken)
  }

  // Custom-slug lookup. Tier-gated.
  const { data: byCustom } = await admin
    .from('albums')
    .select(SELECT_COLUMNS)
    .eq('custom_slug', slug)
    .maybeSingle<FullAlbum>()

  if (!byCustom) {
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

  // Password enforcement is conditional on the OWNER's tier — if they've
  // lapsed below Pro, the password "is removed" (per the FAQ promise) and
  // the album becomes openly viewable again. We still keep the hash on the
  // row so re-upgrading restores it.
  let passwordEnforced = false
  if (album.password_hash && !ownerMatches) {
    const ownerTier = await getUserTierById(album.user_id)
    if (ownerTier !== 'free') passwordEnforced = true
  }

  if (passwordEnforced && album.password_hash) {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(cookieNameForAlbum(album.id))?.value
    const expectedToken = await deriveAccessToken(album.password_hash, album.id)
    const verified = cookie != null && timingSafeEqualString(cookie, expectedToken)

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

  const safe: PublicAlbum & { password_protected: boolean } = {
    id: album.id,
    slug: album.slug,
    custom_slug: album.custom_slug,
    title: album.title,
    description: album.description,
    created_at: album.created_at,
    password_protected: !!album.password_hash,
  }
  return NextResponse.json({ album: safe }, { headers: NO_STORE })
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

async function ownerTokenMatches(albumId: string, supplied: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('albums')
    .select('owner_token')
    .eq('id', albumId)
    .maybeSingle<{ owner_token: string }>()
  if (!data) return false
  return timingSafeEqualString(supplied, data.owner_token)
}
