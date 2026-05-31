import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTier } from '@/lib/subscriptions'
import { validateCustomSlug } from '@/lib/custom-slug'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

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

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to set a custom URL' }, { status: 401, headers: NO_STORE })
  }

  const gate = await requireTier(user, 'pro')
  if (gate) {
    return NextResponse.json({ error: 'Pro plan required' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const access = await verifyAlbumOwnerAccess<{ id: string; owner_token: string; user_id: string | null; custom_slug: string | null }>(slug, token, 'custom_slug')
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }
  const album = access.album

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

  const validation = validateCustomSlug(rawCustom)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400, headers: NO_STORE })
  }
  const newSlug = validation.slug

  if (album.custom_slug === newSlug) {
    return NextResponse.json({ ok: true, custom_slug: newSlug }, { headers: NO_STORE })
  }

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

  // The pre-check above is a UX fast-path only. The unique constraint on
  // (slug, custom_slug) is the correctness guarantee — a 23505 error below
  // means a concurrent request claimed the slug between our check and this
  // write, and is intentionally surfaced as a clean 409.
  const { error: writeError } = await admin
    .from('albums')
    .update({ custom_slug: newSlug, user_id: album.user_id ?? user.id })
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
