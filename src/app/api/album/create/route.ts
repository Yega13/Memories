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
  const {
    data: { user },
  } = await supabase.auth.getUser()
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

    const { error } = await admin.from('albums').insert(row)
    if (!error) {
      return NextResponse.json(
        { slug: nextSlug, owner_token: nextOwnerToken },
        { headers: NO_STORE },
      )
    }
    if (error.code !== '23505') {
      console.error('[album/create] insert failed:', error.code, error.message)
      // TODO: remove debug line after diagnosing
      return NextResponse.json({ error: `DBG:${error.code}:${error.message}` }, { status: 500, headers: NO_STORE })
    }
  }

  return NextResponse.json({ error: 'Could not create a unique album link' }, { status: 500, headers: NO_STORE })
}
