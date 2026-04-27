import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveSubscription } from '@/lib/subscriptions'
import { createCustomerSession } from '@/lib/polar'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const ALLOWED_ORIGIN_HOSTS = new Set(['hushare.space', 'www.hushare.space'])
const ALLOWED_ORIGIN_SUFFIXES = ['.workers.dev', '.pages.dev']

function isAllowedOrigin(origin: string, host: string | null): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (host && url.host === host) return true
  if (ALLOWED_ORIGIN_HOSTS.has(url.host)) return true
  if (ALLOWED_ORIGIN_SUFFIXES.some((s) => url.host.endsWith(s))) return true
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true
  return false
}

// Generates a one-time Polar customer-portal URL for the signed-in user
// and 303s them to it. Linked from the "Manage subscription" button on
// /account. POST-only so it can't be linked from third-party sites.
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (origin && !isAllowedOrigin(origin, host)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/account', req.url), {
      status: 303,
      headers: NO_STORE,
    })
  }

  const subscription = await getActiveSubscription(user.id)
  if (!subscription) {
    return NextResponse.json(
      { error: 'No active subscription' },
      { status: 404, headers: NO_STORE },
    )
  }

  let portalUrl: string
  try {
    portalUrl = await createCustomerSession(subscription.polar_customer_id)
  } catch (err) {
    console.error('[portal] Polar customer session failed:', err)
    return NextResponse.json(
      { error: 'Could not open the billing portal. Please try again.' },
      { status: 502, headers: NO_STORE },
    )
  }

  return NextResponse.redirect(portalUrl, { status: 303, headers: NO_STORE })
}
