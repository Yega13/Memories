import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { timingSafeEqual } from '@/lib/timing-safe'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

type AlbumOwnerBase = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
}

type AccessOk<T extends AlbumOwnerBase> = {
  ok: true
  album: T
  userId: string | null
}

type AccessFail = {
  ok: false
  status: number
  error: string
  reason: 'missing' | 'not_found' | 'bad_token' | 'access_denied'
}

const PROTECTED_MANAGEMENT_SLUGS = new Set([
  'tfromthefans',
  'tpeakframes',
  'redhavenepreleaseshow',
  'talixfans',
])


export async function verifyAlbumOwnerAccess<T extends AlbumOwnerBase = AlbumOwnerBase>(
  slug: string,
  ownerToken: string,
  extraColumns = '',
): Promise<AccessOk<T> | AccessFail> {
  const cleanSlug = slug.trim()
  const cleanToken = ownerToken.trim()
  if (!cleanSlug || !cleanToken) {
    return { ok: false, status: 400, error: 'Missing slug or owner_token', reason: 'missing' }
  }

  const admin = createAdminClient()
  const columns = Array.from(new Set(['id', 'owner_token', 'user_id', 'custom_slug', ...extraColumns.split(',').map((column) => column.trim()).filter(Boolean)])).join(', ')
  const { data: album, error } = await admin
    .from('albums')
    .select(columns)
    .eq('slug', cleanSlug)
    .maybeSingle<T>()

  if (error || !album) {
    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
  }
  if (!timingSafeEqual(cleanToken, album.owner_token)) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const PROTECTED_MANAGEMENT_EMAILS: Set<string> | null = process.env.PROTECTED_MANAGEMENT_EMAILS
    ? new Set(process.env.PROTECTED_MANAGEMENT_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
    : null

  const protectedManagement = PROTECTED_MANAGEMENT_EMAILS !== null &&
    (PROTECTED_MANAGEMENT_SLUGS.has(cleanSlug) || (album.custom_slug ? PROTECTED_MANAGEMENT_SLUGS.has(album.custom_slug) : false))
  if (protectedManagement) {
    const email = user?.email?.toLowerCase()
    if (!email || !PROTECTED_MANAGEMENT_EMAILS!.has(email)) {
      return { ok: false, status: 403, error: "You don't have access", reason: 'access_denied' }
    }
    return { ok: true, album, userId: user?.id ?? null }
  }

  if (user) {
    await admin.from('albums').update({ user_id: user.id }).eq('id', album.id).is('user_id', null)
  }

  return { ok: true, album, userId: user?.id ?? null }
}

// Rate-limited wrapper for settings endpoints. Adds 30 req/min per IP before calling
// verifyAlbumOwnerAccess so no settings route can be DoS'd or used for token enumeration.
export async function verifyOwnerWithRateLimit(
  req: Request,
  slug: string,
  token: string,
  extraColumns?: string,
) {
  const ipRl = await checkRateLimit(clientIpKey(req, 'owner_settings'), 60, 30)
  if (!ipRl.ok) {
    return { ok: false as const, status: 429, error: 'Too many requests. Please slow down.', reason: 'rate_limited' as const }
  }
  return verifyAlbumOwnerAccess(slug, token, extraColumns)
}

// Cookie-based owner verification. Reads the HttpOnly hushare_owner_{albumId} cookie set by
// /api/album/owner-login instead of accepting owner_token from the request body. This keeps
// the token out of server logs, request bodies, and Referer headers after the initial exchange.
export async function verifyOwnerViaCookie<T extends AlbumOwnerBase = AlbumOwnerBase>(
  slug: string,
  extraColumns = '',
): Promise<AccessOk<T> | AccessFail> {
  const cleanSlug = slug.trim()
  if (!cleanSlug) {
    return { ok: false, status: 400, error: 'Missing slug', reason: 'missing' }
  }

  const admin = createAdminClient()
  const columns = Array.from(new Set(['id', 'owner_token', 'user_id', 'custom_slug', ...extraColumns.split(',').map((c) => c.trim()).filter(Boolean)])).join(', ')
  const { data: album, error } = await admin
    .from('albums')
    .select(columns)
    .eq('slug', cleanSlug)
    .maybeSingle<T>()

  if (error || !album) {
    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
  }

  const cookieStore = await cookies()
  const ownerCookie = (cookieStore.get(`hushare_owner_${album.id}`)?.value ?? '').trim()
  if (!timingSafeEqual(ownerCookie, album.owner_token)) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const PROTECTED_MANAGEMENT_EMAILS: Set<string> | null = process.env.PROTECTED_MANAGEMENT_EMAILS
    ? new Set(process.env.PROTECTED_MANAGEMENT_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
    : null

  const protectedManagement = PROTECTED_MANAGEMENT_EMAILS !== null &&
    (PROTECTED_MANAGEMENT_SLUGS.has(cleanSlug) || (album.custom_slug ? PROTECTED_MANAGEMENT_SLUGS.has(album.custom_slug) : false))
  if (protectedManagement) {
    const email = user?.email?.toLowerCase()
    if (!email || !PROTECTED_MANAGEMENT_EMAILS!.has(email)) {
      return { ok: false, status: 403, error: "You don't have access", reason: 'access_denied' }
    }
    return { ok: true, album, userId: user?.id ?? null }
  }

  if (user) {
    await admin.from('albums').update({ user_id: user.id }).eq('id', album.id).is('user_id', null)
  }

  return { ok: true, album, userId: user?.id ?? null }
}

// Rate-limited cookie-based wrapper. Same rate limit as verifyOwnerWithRateLimit.
export async function verifyOwnerViaCookieWithRateLimit(
  req: Request,
  slug: string,
  extraColumns?: string,
) {
  const ipRl = await checkRateLimit(clientIpKey(req, 'owner_settings'), 60, 30)
  if (!ipRl.ok) {
    return { ok: false as const, status: 429, error: 'Too many requests. Please slow down.', reason: 'rate_limited' as const }
  }
  return verifyOwnerViaCookie(slug, extraColumns)
}
