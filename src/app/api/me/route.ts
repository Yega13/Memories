import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasAccountAccess } from '@/lib/access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Tells the client whether the current session can reach /account.
// Used by AccountNavLink so subscribers see "Account" in the nav, not
// "Sign out". The check matches the server-side gate on /account itself.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { signedIn: false, canAccessAccount: false },
      { headers: NO_STORE },
    )
  }

  const canAccessAccount = await hasAccountAccess(user)
  return NextResponse.json(
    { signedIn: true, canAccessAccount },
    { headers: NO_STORE },
  )
}
