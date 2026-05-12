
const ADMIN_EMAILS = new Set<string>([
  'alinagnuni3@gmail.com',
  'yeganyansuren13@gmail.com',
])

type AuthUserLike = { email?: string | null } | null | undefined

export function isAccountAdmin(user: AuthUserLike): boolean {
  const email = user?.email?.toLowerCase()
  if (!email) return false
  return ADMIN_EMAILS.has(email)
}
