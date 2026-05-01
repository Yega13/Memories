import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  cookieNameForAlbum,
  deriveAccessToken,
  PASSWORD_COOKIE_MAX_AGE_SECONDS,
  verifyPassword,
} from '@/lib/album-password'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Verify a guest-supplied password for a password-protected album. On
// success, drops a per-album HttpOnly access cookie that future requests
// (the resolver) check to short-circuit the gate.
//
// Body: { slug, password }
//
// Note: we resolve by random slug only here. Custom-slug visitors must hit
// the resolver first, which redirects-or-renders based on what it knows;
// this endpoint is only called once the gate UI is on screen, and the gate
// UI knows the random slug from the resolver response.
export async function POST(req: Request) {
  let body: { slug?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }
  const slug = String(body.slug ?? '').trim()
  const password = String(body.password ?? '')
  if (!slug || !password) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album } = await admin
    .from('albums')
    .select('id, password_hash')
    .eq('slug', slug)
    .maybeSingle<{ id: string; password_hash: string | null }>()

  // Don't reveal whether the album exists — both bad-password and unknown
  // slug return the same shape.
  if (!album || !album.password_hash) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401, headers: NO_STORE })
  }

  const ok = await verifyPassword(password, album.password_hash)
  if (!ok) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401, headers: NO_STORE })
  }

  const token = await deriveAccessToken(album.password_hash, album.id)
  const cookieStore = await cookies()
  cookieStore.set(cookieNameForAlbum(album.id), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: PASSWORD_COOKIE_MAX_AGE_SECONDS,
  })

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
