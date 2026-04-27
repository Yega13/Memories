// Identity-only helpers. Safe to import from anywhere (client or server).
//
// The full account-access check (admin OR active subscriber) lives in
// `@/lib/access` because it queries the DB and is server-only.

const ADMIN_EMAILS = new Set<string>([
  'yeganyansuren13@gmail.com',
])

type AuthUserLike = { email?: string | null } | null | undefined

export function isAccountAdmin(user: AuthUserLike): boolean {
  const email = user?.email?.toLowerCase()
  if (!email) return false
  return ADMIN_EMAILS.has(email)
}
