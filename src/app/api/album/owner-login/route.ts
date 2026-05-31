import { NextResponse } from 'next/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const OWNER_COOKIE_PREFIX = 'hushare_owner_'
const OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

// Exchanges a plain-text owner_token (from a share URL) for an HttpOnly session cookie,
// then redirects to the album. This prevents the token from living in browser history,
// server access logs, or Referer headers sent to third-party analytics.
//
// Usage: the album page detects an owner token on first load and POSTs here.
// The client normalizes legacy query-token links into fragment-token links so the
// token is not sent in future HTTP requests or referrer headers.
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  // Per-IP rate limit: prevents token brute-forcing even from many albums simultaneously.
  const ipRl = await checkRateLimit(clientIpKey(req, 'owner_login'), 300, 10)
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait before trying again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipRl.retryAfterSeconds) } },
    )
  }

  let body: { slug?: string; owner_token?: string }
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

  // Per-slug rate limit: caps attempts against a specific album from distributed IPs.
  const slugRl = await checkRateLimit(`owner_login_slug:${slug}`, 300, 20)
  if (!slugRl.ok) {
    return NextResponse.json(
      { error: 'Too many attempts on this album. Please wait.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(slugRl.retryAfterSeconds) } },
    )
  }

  const access = await verifyAlbumOwnerAccess(slug, token)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const res = NextResponse.json({ ok: true, redirect: `/${slug}` }, { headers: NO_STORE })
  res.cookies.set(`${OWNER_COOKIE_PREFIX}${access.album.id}`, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OWNER_COOKIE_MAX_AGE,
  })
  return res
}
