import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { hasAccountAccess } from '@/lib/access'
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase/config'

export const runtime = 'nodejs'

// Magic-link / OAuth landing route. Supabase redirects here with a `code`
// query param after the user clicks the email link or completes the OAuth
// consent screen. We exchange the code for a session cookie and forward on.
//
// We intentionally do NOT use the shared `createClient` helper here: that
// helper writes session cookies via `cookies().set()`, and on Cloudflare
// Workers (via OpenNext) those writes do not always attach to a
// `NextResponse.redirect()` returned from a Route Handler. Writing cookies
// directly onto the response object we return is the safe pattern.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const rawNext = url.searchParams.get('next') ?? ''

  // Only allow same-origin redirects to prevent open-redirect abuse.
  const requestedNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }

  const cookieStore = await cookies()
  const pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = []

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) pendingCookies.push(c)
      },
    },
  })

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchange failed:', error.message)
    return NextResponse.redirect(new URL('/login?error=invalid_code', url.origin))
  }

  // Route by access policy: admins/subscribers go to /account, everyone
  // else goes to wherever they came from (or homepage). This keeps a
  // newly-signed-in free user from landing on a 403 page.
  const allowed = await hasAccountAccess(data.user)
  const target = allowed
    ? requestedNext ?? '/account'
    : requestedNext && requestedNext !== '/account' ? requestedNext : '/'

  const response = NextResponse.redirect(new URL(target, url.origin))
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options)
  }
  return response
}
