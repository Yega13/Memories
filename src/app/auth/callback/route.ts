import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Magic-link landing route. The user clicks the link in their email,
// Supabase redirects here with a `code` query param, we exchange that
// for a session cookie and send them on to `next` (default /account).
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/account'

  // Only allow same-origin redirects to prevent open-redirect abuse.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchange failed:', error.message)
    return NextResponse.redirect(new URL('/login?error=invalid_code', url.origin))
  }

  return NextResponse.redirect(new URL(safeNext, url.origin))
}
