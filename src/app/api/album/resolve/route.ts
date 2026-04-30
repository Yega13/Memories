import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTier } from '@/lib/subscriptions'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Resolve a URL slug to an album. Two paths can hit this:
//   - random slug ('abc123de') → always resolves if the album exists
//   - custom slug ('anna-and-david') → only resolves if the binding user
//     currently has a Pro+ subscription. On downgrade the custom URL silently
//     stops working, exactly as advertised on the pricing FAQ.
//
// Returns the safe public album shape — never owner_token, password_hash,
// or user_id. The browser uses the rest of the album the way it always did.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const slug = (searchParams.get('slug') ?? '').trim()
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // Random-slug lookup first. The vast majority of URLs hit this branch and
  // never need a tier check — keep the hot path fast.
  const { data: byRandom } = await admin
    .from('albums')
    .select('id, slug, custom_slug, title, description, created_at')
    .eq('slug', slug)
    .maybeSingle<PublicAlbum>()

  if (byRandom) {
    return NextResponse.json({ album: byRandom }, { headers: NO_STORE })
  }

  // Custom-slug lookup. Pull user_id so we can check tier; strip it before
  // returning anything to the browser.
  const { data: byCustom } = await admin
    .from('albums')
    .select('id, slug, custom_slug, title, description, created_at, user_id')
    .eq('custom_slug', slug)
    .maybeSingle<PublicAlbum & { user_id: string | null }>()

  if (!byCustom) {
    return NextResponse.json({ album: null }, { status: 404, headers: NO_STORE })
  }

  const tier = await getUserTier(byCustom.user_id)
  if (tier === 'free') {
    // Owner downgraded — pretend the custom URL doesn't exist. The album is
    // still reachable via its random slug.
    return NextResponse.json({ album: null }, { status: 404, headers: NO_STORE })
  }

  const { user_id: _omit, ...safe } = byCustom
  return NextResponse.json({ album: safe }, { headers: NO_STORE })
}

type PublicAlbum = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  description: string | null
  created_at: string
}
