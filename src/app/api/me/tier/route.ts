import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserTier } from '@/lib/subscriptions'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Returns the current user's tier. Anonymous (not signed in) → 'free'. The
// browser uses this to decide whether to show paid-tier UI like "Set custom
// URL". Never make the gating decision on this response alone — every write
// endpoint also re-checks tier server-side.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tier = await getUserTier(user?.id ?? null)
  return NextResponse.json({ tier }, { headers: NO_STORE })
}
