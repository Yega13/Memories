const RESERVED_SLUGS = new Set([
  'account', 'admin', 'api', 'app', 'auth',
  'billing', 'c', 'callback', 'checkout', 'contact',
  'dashboard', 'faq', 'help', 'home', 'hushare',
  'index', 'legal', 'login', 'logout', 'manifest',
  'me', 'oauth', 'pricing', 'privacy', 'report', 'robots',
  'signin', 'signout', 'signup', 'sitemap', 'support',
  'terms', 'tos', 'webhook', 'webhooks',
])

export type SlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; reason: string }

export function validateCustomSlug(input: unknown): SlugValidationResult {
  if (typeof input !== 'string') return { ok: false, reason: 'Must be text' }
  const slug = input.trim().toLowerCase()

  if (slug.length < 3) return { ok: false, reason: 'At least 3 characters' }
  if (slug.length > 40) return { ok: false, reason: 'At most 40 characters' }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { ok: false, reason: 'Only letters, numbers, and hyphens' }
  }
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return { ok: false, reason: 'Cannot start or end with a hyphen' }
  }
  if (slug.includes('--')) {
    return { ok: false, reason: 'No consecutive hyphens' }
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: 'This name is reserved' }
  }

  return { ok: true, slug }
}
