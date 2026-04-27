import { isAccountAdmin } from './auth'
import { isActiveSubscriber } from './subscriptions'

// Server-only — runs a DB query. Use this on routes/pages that gate
// the account dashboard. Returns true for admins OR active subscribers.
export async function hasAccountAccess(
  user: { id?: string; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (isAccountAdmin(user)) return true
  return isActiveSubscriber(user)
}
