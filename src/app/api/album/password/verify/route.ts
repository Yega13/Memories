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

// Rate-limiting policy. Tuned so a typo'ing legit user never hits the wall
// (10 tries is generous), but a brute-force attempt still gets locked out fast.
const WINDOW_SECONDS = 5 * 60        // sliding window we count failures in
const MAX_FAILURES_PER_WINDOW = 10   // >= this many failed guesses -> lockout
const LOCKOUT_SECONDS = 5 * 60       // how long the gate stays closed

// Verify a guest-supplied password. Sets an HttpOnly per-album access cookie
// on success. Rate-limits per album (album_id is the brute-force target;
// IP rotation by attackers wouldn't help because we don't key on IP).
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

  // Don't reveal whether the album exists - both bad-password and unknown
  // slug return the same "Incorrect password" shape.
  if (!album || !album.password_hash) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401, headers: NO_STORE })
  }

  // Lockout check BEFORE running PBKDF2 (which is 100+ ms of CPU). If the
  // album is locked, we want to fail fast and not give the attacker free
  // hashing work either.
  const ip = clientIp(req)
  const since = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString()
  const { count: recentFailures } = await admin
    .from('album_password_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', album.id)
    .eq('succeeded', false)
    .gte('created_at', since)

  if (recentFailures != null && recentFailures >= MAX_FAILURES_PER_WINDOW) {
    return NextResponse.json(
      {
        error: 'Too many attempts. Please try again in a few minutes.',
        retry_after_seconds: LOCKOUT_SECONDS,
      },
      {
        status: 429,
        headers: { ...NO_STORE, 'Retry-After': String(LOCKOUT_SECONDS) },
      },
    )
  }

  const ok = await verifyPassword(password, album.password_hash)

  // Log the attempt either way; the rate limiter depends on failed attempts
  // being persisted before the response returns.
  const { error: logError } = await admin
    .from('album_password_attempts')
    .insert({ album_id: album.id, ip, succeeded: ok })
  if (logError) console.error('[password/verify] attempt log failed:', logError.message)

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

// Cloudflare exposes the real client IP in `cf-connecting-ip`. Fall back to
// the leftmost x-forwarded-for entry, then to null. Truncated to keep
// stored values bounded - IP isn't a primary key, just an audit hint.
function clientIp(req: Request): string | null {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf.slice(0, 64)
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim().slice(0, 64)
  return null
}
