import { NextResponse } from 'next/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const OWNER_COOKIE_PREFIX = 'hushare_owner_'
const OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

// Exchanges a plain-text owner_token (from a share URL) for an HttpOnly session cookie,
// then redirects to the album. This prevents the token from living in browser history,
// server access logs, or Referer headers sent to third-party analytics.
//
// Usage: the album page detects ?owner=TOKEN on first load, POSTs here, then replaces
// the URL with the clean slug path. Future loads read the HttpOnly cookie instead.
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

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
