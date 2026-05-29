
const raw = process.env.ADMIN_EMAILS ?? ''
const ADMIN_EMAILS = new Set<string>(
  raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
)

type AuthUserLike = { email?: string | null } | null | undefined

export function isAccountAdmin(user: AuthUserLike): boolean {
  if (ADMIN_EMAILS.size === 0) return false
  const email = user?.email?.toLowerCase()
  if (!email) return false
  return ADMIN_EMAILS.has(email)
}
