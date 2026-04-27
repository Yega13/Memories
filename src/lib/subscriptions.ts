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
