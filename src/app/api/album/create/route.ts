import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

function slug() {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

function ownerToken() {
  return randomUUID().replace(/-/g, '')
}

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { title?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const title = String(body.title ?? '').trim().slice(0, 120)
  if (!title) {
    return NextResponse.json({ error: 'Please give your album a name' }, { status: 400, headers: NO_STORE })
  }

  // 30 albums per hour per IP. Fail-open: if the rate_limit_events table doesn't exist
  // yet the request is allowed through. Run the 20260522 migration to activate this.
  const rl = await checkRateLimit(clientIpKey(req, 'album_create'), 60 * 60, 30, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many albums created. Please try again later.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const supabase = await createClient()
  // getUser() can return null in Cloudflare Workers Route Handlers when the middleware-refreshed
  // session cookie isn't forwarded to the handler's request. Fall back to getSession() which
  // reads the JWT from the cookie directly without a Supabase network round-trip.
  let { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const { data: { session } } = await supabase.auth.getSession()
    user = session?.user ?? null
  }
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (err) {
    console.error('[album/create] createAdminClient failed — SUPABASE_SERVICE_ROLE_KEY missing?', err)
    return NextResponse.json({ error: 'Service configuration error. Please try again.' }, { status: 503, headers: NO_STORE })
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextSlug = slug()
    const nextOwnerToken = ownerToken()
    // video_autoplay defaults to TRUE on new albums. The DB column default is false, so we have
    // to set it explicitly here — otherwise new albums open videos with autoplay off, which
    // doesn't match the documented "enabled by default" behavior. Existing rows are untouched,
    // so anyone who deliberately turned autoplay off keeps that choice.
    const row = user
      ? { slug: nextSlug, owner_token: nextOwnerToken, title, user_id: user.id, video_autoplay: true }
      : { slug: nextSlug, owner_token: nextOwnerToken, title, video_autoplay: true }

    let { error } = await admin.from('albums').insert(row)

    // 42703 = column does not exist. The video_autoplay column was added in migration
    // 20260504_album_media_display_settings.sql which may not yet be applied in production.
    // Retry without it so album creation never hard-fails due to a pending migration.
    if (error?.code === '42703') {
      console.warn('[album/create] video_autoplay column missing — retrying without it. Apply 20260504_album_media_display_settings.sql migration.')
      const fallbackRow = user
        ? { slug: nextSlug, owner_token: nextOwnerToken, title, user_id: user.id }
        : { slug: nextSlug, owner_token: nextOwnerToken, title }
      ;({ error } = await admin.from('albums').insert(fallbackRow))
    }

    if (!error) {
      return NextResponse.json(
        { slug: nextSlug, owner_token: nextOwnerToken },
        { headers: NO_STORE },
      )
    }
    if (error.code !== '23505') {
      console.error('[album/create] insert failed:', error.code, error.message)
      return NextResponse.json({ error: 'Could not create album' }, { status: 500, headers: NO_STORE })
    }
  }

  return NextResponse.json({ error: 'Could not create a unique album link' }, { status: 500, headers: NO_STORE })
}
