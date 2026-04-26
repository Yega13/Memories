// Account-access policy.
//
// Today: only admins (founders) can access /account. Once Polar billing ships,
// active Pro/Studio subscribers will join them — extend `canAccessAccount`
// with a subscription check at that point.

const ADMIN_EMAILS = new Set<string>([
  'yeganyansuren13@gmail.com',
])

type AuthUserLike = { email?: string | null } | null | undefined

export function isAccountAdmin(user: AuthUserLike): boolean {
  const email = user?.email?.toLowerCase()
  if (!email) return false
  return ADMIN_EMAILS.has(email)
}

export function canAccessAccount(user: AuthUserLike): boolean {
  // TODO(billing): || isActiveSubscriber(user) once Polar integration lands.
  return isAccountAdmin(user)
}
