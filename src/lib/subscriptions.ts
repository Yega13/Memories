import { createClient as createServerClient } from '@/lib/supabase/server'

export type Subscription = {
  id: string
  user_id: string
  polar_subscription_id: string
  polar_customer_id: string
  polar_product_id: string
  tier: 'pro' | 'studio'
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

// Returns the user's most recent subscription if it currently grants access.
// "Grants access" = active, OR canceled-but-still-in-paid-period.
export async function getActiveSubscription(userId: string): Promise<Subscription | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<Subscription>()

  if (error) {
    console.error('[subscriptions] query failed:', error.message)
    return null
  }
  if (!data) return null

  if (data.status === 'active' || data.status === 'trialing') return data

  // Treat canceled / past_due as still-active until the paid period actually ends.
  if (data.status === 'canceled' || data.status === 'past_due') {
    if (!data.current_period_end) return null
    if (new Date(data.current_period_end) > new Date()) return data
  }

  return null
}

export async function isActiveSubscriber(user: { id?: string } | null | undefined): Promise<boolean> {
  if (!user?.id) return false
  return (await getActiveSubscription(user.id)) !== null
}

export type Tier = 'free' | 'pro' | 'studio'

// Tier rank: every feature gate compares numerically so we don't have to
// hand-roll OR-chains like (tier === 'pro' || tier === 'studio') everywhere.
const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }

// Resolve the live tier for a user. Anonymous (no userId) is always 'free'.
// A Studio sub returns 'studio'; an in-period Pro sub returns 'pro'; an
// expired or absent sub returns 'free'. Always read this fresh — never cache
// across requests.
export async function getUserTier(userId: string | null | undefined): Promise<Tier> {
  if (!userId) return 'free'
  const sub = await getActiveSubscription(userId)
  if (!sub) return 'free'
  return sub.tier
}

// Gate helper for API routes. Returns null if the user has at least `min`,
// otherwise returns the actual tier so the caller can decide between 401
// (no user) and 403 (wrong tier).
//
// Typical use:
//   const gate = await requireTier(userId, 'studio')
//   if (gate) return NextResponse.json({ error: `Studio plan required` }, { status: 403 })
export async function requireTier(
  userId: string | null | undefined,
  min: Tier,
): Promise<{ have: Tier } | null> {
  const have = await getUserTier(userId)
  if (TIER_RANK[have] >= TIER_RANK[min]) return null
  return { have }
}
