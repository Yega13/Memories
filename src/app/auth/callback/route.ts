import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canAccessAccount } from '@/lib/auth'

export const runtime = 'nodejs'

// Magic-link landing route. The user clicks the link in their email,
// Supabase redirects here with a `code` query param, we exchange that
// for a session cookie and forward them on.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const rawNext = url.searchParams.get('next') ?? ''

  // Only allow same-origin redirects to prevent open-redirect abuse.
  const requestedNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchange failed:', error.message)
    return NextResponse.redirect(new URL('/login?error=invalid_code', url.origin))
  }

  // Route by access policy: admins/subscribers go to /account, everyone
  // else goes to wherever they came from (or homepage). This keeps a
  // newly-signed-in free user from landing on a 403 page.
  const target = canAccessAccount(data.user)
    ? requestedNext ?? '/account'
    : requestedNext && requestedNext !== '/account' ? requestedNext : '/'

  return NextResponse.redirect(new URL(target, url.origin))
}
