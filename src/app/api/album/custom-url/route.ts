import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTier } from '@/lib/subscriptions'
import { validateCustomSlug } from '@/lib/custom-slug'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Set or clear the custom URL on an album. Requires three things in concert:
//   1. The caller is signed in (we need a user_id to bind the album to).
//   2. They prove ownership with the random slug + owner_token pair.
//   3. Their live subscription is Pro or Studio. Trial counts as 'pro'.
//
// Body: { slug: string, owner_token: string, custom_slug: string | null }
// Pass null/empty to clear an existing custom URL.
export async function POST(req: Request) {
  let body: { slug?: string; owner_token?: string; custom_slug?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const rawCustom = body.custom_slug
  if (!slug || !token) {
    return NextResponse.json({ error: 'Missing slug or owner_token' }, { status: 400, headers: NO_STORE })
  }

  // 1. Auth — must be signed in to claim a custom URL.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to set a custom URL' }, { status: 401, headers: NO_STORE })
  }

  // 2. Tier — must be Pro or Studio. Pass the full user so the admin
  // override in getUserTier kicks in for in-house testing.
  const gate = await requireTier(user, 'pro')
  if (gate) {
    return NextResponse.json({ error: 'Pro plan required' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // 3. Ownership — find the album by random slug and timing-safely compare
  // the supplied owner_token. Use admin so column-level GRANTs don't hide
  // owner_token from us here.
  const { data: album, error: lookupError } = await admin
    .from('albums')
    .select('id, owner_token, custom_slug, user_id')
    .eq('slug', slug)
    .maybeSingle<{ id: string; owner_token: string; custom_slug: string | null; user_id: string | null }>()

  if (lookupError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!timingSafeEqual(token, album.owner_token)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  // Clear path: custom_slug = null (or empty).
  const isClear = rawCustom === null || rawCustom === undefined || (typeof rawCustom === 'string' && rawCustom.trim() === '')
  if (isClear) {
    const { error } = await admin
      .from('albums')
      .update({ custom_slug: null })
      .eq('id', album.id)
    if (error) {
      console.error('[custom-url] clear failed:', error.message)
      return NextResponse.json({ error: 'Could not clear custom URL' }, { status: 500, headers: NO_STORE })
    }
    return NextResponse.json({ ok: true, custom_slug: null }, { headers: NO_STORE })
  }

  // Set path — validate format first.
  const validation = validateCustomSlug(rawCustom)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400, headers: NO_STORE })
  }
  const newSlug = validation.slug

  // No-op early-return if it already matches what's on the row.
  if (album.custom_slug === newSlug && album.user_id === user.id) {
    return NextResponse.json({ ok: true, custom_slug: newSlug }, { headers: NO_STORE })
  }

  // Collision check: a custom slug must not equal anyone's random slug or
  // any other album's custom_slug. Excluding our own row keeps re-saves of
  // the same value working.
  const { data: clash, error: clashError } = await admin
    .from('albums')
    .select('id')
    .neq('id', album.id)
    .or(`slug.eq.${newSlug},custom_slug.eq.${newSlug}`)
    .limit(1)
    .maybeSingle()

  if (clashError) {
    console.error('[custom-url] clash check failed:', clashError.message)
    return NextResponse.json({ error: 'Could not verify availability' }, { status: 500, headers: NO_STORE })
  }
  if (clash) {
    return NextResponse.json({ error: 'That URL is already taken' }, { status: 409, headers: NO_STORE })
  }

  // Bind album to this user (so future tier checks have someone to look up)
  // and write the new custom slug. Both fields update together.
  const { error: writeError } = await admin
    .from('albums')
    .update({ custom_slug: newSlug, user_id: user.id })
    .eq('id', album.id)

  if (writeError) {
    // Race condition: another request between our clash-check and update.
    // The unique constraint surfaces it as 23505.
    if ((writeError as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'That URL is already taken' }, { status: 409, headers: NO_STORE })
    }
    console.error('[custom-url] write failed:', writeError.message)
    return NextResponse.json({ error: 'Could not save custom URL' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, custom_slug: newSlug }, { headers: NO_STORE })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
