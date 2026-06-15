
type AuthUserLike = { email?: string | null } | null | undefined

export function isAccountAdmin(user: AuthUserLike): boolean {
  const raw = process.env.ADMIN_EMAILS ?? ''
  const emails = new Set<string>(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
  if (emails.size === 0) return false
  const email = user?.email?.toLowerCase()
  if (!email) return false
  return emails.has(email)
}
