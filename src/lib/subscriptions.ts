import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'

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

function isSubActive(sub: { status: string; current_period_end: string | null }): boolean {
  if (sub.status === 'active' || sub.status === 'trialing') return true
  if (sub.status === 'canceled' || sub.status === 'past_due') {
    return !!sub.current_period_end && new Date(sub.current_period_end) > new Date()
  }
  return false
}

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
  if (!data || !isSubActive(data)) return null
  return data
}

export async function isActiveSubscriber(user: { id?: string } | null | undefined): Promise<boolean> {
  if (!user?.id) return false
  return (await getActiveSubscription(user.id)) !== null
}

export type Tier = 'free' | 'pro' | 'studio'

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }

type UserLike = { id?: string | null; email?: string | null } | null | undefined

export async function getUserTier(user: UserLike): Promise<Tier> {
  if (!user?.id) return 'free'
  if (isAccountAdmin(user)) return 'studio'
  const sub = await getActiveSubscription(user.id)
  return sub?.tier ?? 'free'
}

// Safe for server-only/cron contexts: uses admin client, no cookie session needed.
export async function getUserTierById(userId: string | null | undefined): Promise<Tier> {
  if (!userId) return 'free'

  const admin = createAdminClient()

  // Query subscriptions with the admin client (bypasses RLS — safe since this
  // only runs in trusted server/cron code, never in user-facing routes).
  const { data: sub } = await admin
    .from('subscriptions')
    .select('tier, status, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<Subscription>()

  if (sub && isSubActive(sub)) return sub.tier

  const { data: authData } = await admin.auth.admin.getUserById(userId)
  if (isAccountAdmin({ email: authData?.user?.email })) return 'studio'
  return 'free'
}

export async function requireTier(
  user: UserLike,
  min: Tier,
): Promise<{ have: Tier } | null> {
  const have = await getUserTier(user)
  if (TIER_RANK[have] >= TIER_RANK[min]) return null
  return { have }
}
