import { isAccountAdmin } from './auth'
import { isActiveSubscriber } from './subscriptions'

export async function hasAccountAccess(
  user: { id?: string; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (isAccountAdmin(user)) return true
  return isActiveSubscriber(user)
}
