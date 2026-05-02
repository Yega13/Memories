import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTier } from '@/lib/subscriptions'
import { hashPassword, MIN_PASSWORD_LEN, MAX_PASSWORD_LEN } from '@/lib/album-password'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Set or clear the album password. Requires:
//   1. Signed-in (we bind albums.user_id like the custom-URL flow does).
//   2. Live tier ≥ Pro (with the admin override from getUserTier).
//   3. Ownership via slug + owner_token.
//
// Body: { slug, owner_token, password: string | null }
// Pass null/empty string to clear.
export async function POST(req: Request) {
  let body: { slug?: string; owner_token?: string; password?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  if (!slug || !token) {
    return NextResponse.json({ error: 'Missing slug or owner_token' }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to set a password' }, { status: 401, headers: NO_STORE })
  }

  const gate = await requireTier(user, 'pro')
  if (gate) {
    return NextResponse.json({ error: 'Pro plan required' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album, error: lookupError } = await admin
    .from('albums')
    .select('id, owner_token, user_id')
    .eq('slug', slug)
    .maybeSingle<{ id: string; owner_token: string; user_id: string | null }>()

  if (lookupError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!timingSafeEqual(token, album.owner_token)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }
  if (album.user_id && album.user_id !== user.id) {
    return NextResponse.json({ error: 'This album is bound to another account' }, { status: 403, headers: NO_STORE })
  }

  // Clear path.
  const raw = body.password
  const isClear = raw === null || raw === undefined || (typeof raw === 'string' && raw === '')
  if (isClear) {
    const { error } = await admin
      .from('albums')
      .update({ password_hash: null })
      .eq('id', album.id)
    if (error) {
      console.error('[password] clear failed:', error.message)
      return NextResponse.json({ error: 'Could not clear password' }, { status: 500, headers: NO_STORE })
    }
    return NextResponse.json({ ok: true, password_protected: false }, { headers: NO_STORE })
  }

  // Set path.
  if (typeof raw !== 'string') {
    return NextResponse.json({ error: 'Password must be text' }, { status: 400, headers: NO_STORE })
  }
  if (raw.length < MIN_PASSWORD_LEN) {
    return NextResponse.json({ error: `At least ${MIN_PASSWORD_LEN} characters` }, { status: 400, headers: NO_STORE })
  }
  if (raw.length > MAX_PASSWORD_LEN) {
    return NextResponse.json({ error: `At most ${MAX_PASSWORD_LEN} characters` }, { status: 400, headers: NO_STORE })
  }

  // We bind albums.user_id here too so future tier checks (resolver looking
  // up the owner's tier) have someone to call out. Mirrors the custom-URL
  // flow exactly.
  let password_hash: string
  try {
    password_hash = await hashPassword(raw)
  } catch (e) {
    console.error('[password] hash failed:', e)
    return NextResponse.json({ error: 'Could not prepare password protection' }, { status: 500, headers: NO_STORE })
  }

  const { error: writeError } = await admin
    .from('albums')
    .update({ password_hash, user_id: user.id })
    .eq('id', album.id)
  if (writeError) {
    console.error('[password] write failed:', writeError.message)
    return NextResponse.json({ error: 'Could not save password' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, password_protected: true }, { headers: NO_STORE })
}
