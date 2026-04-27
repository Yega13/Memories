// Thin wrapper around the Polar REST API. We deliberately don't use
// @polar-sh/sdk so we can keep the Worker bundle small and the surface
// minimal — only the two operations we actually need.

const PROD_BASE = 'https://api.polar.sh'
const SANDBOX_BASE = 'https://sandbox-api.polar.sh'

function apiBase(): string {
  // Default to production unless POLAR_SANDBOX === "true".
  return process.env.POLAR_SANDBOX === 'true' ? SANDBOX_BASE : PROD_BASE
}

function apiKey(): string {
  const key = process.env.POLAR_API_KEY
  if (!key) throw new Error('POLAR_API_KEY not set')
  return key
}

export type CheckoutInput = {
  productId: string
  successUrl: string
  customerEmail: string
  metadata: { userId: string; tier: 'pro' | 'studio'; cycle: 'monthly' | 'yearly' }
  discountId?: string
}

export type CheckoutResult = {
  id: string
  url: string
}

export async function createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const body: Record<string, unknown> = {
    products: [input.productId],
    success_url: input.successUrl,
    customer_email: input.customerEmail,
    metadata: input.metadata,
  }
  if (input.discountId) body.discount_id = input.discountId

  const res = await fetch(`${apiBase()}/v1/checkouts/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Polar checkout creation failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { id: string; url: string }
  return { id: data.id, url: data.url }
}

// Creates a one-time customer-portal session for an existing Polar customer.
// Returned URL is signed and short-lived; redirect the user straight to it.
export async function createCustomerSession(customerId: string): Promise<string> {
  const res = await fetch(`${apiBase()}/v1/customer-sessions/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customer_id: customerId }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Polar customer session creation failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { customer_portal_url: string }
  return data.customer_portal_url
}

// Standard Webhooks (https://www.standardwebhooks.com) signature verification.
// Polar prefixes the secret with `polar_whs_`; the suffix is the base64 key.
export async function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')

  if (!id || !timestamp || !signatureHeader) return false

  // Reject signatures more than 5 minutes old to limit replay window.
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

  const base64Secret = secret.replace(/^polar_whs_/, '').replace(/^whsec_/, '')
  let keyMaterial: Uint8Array<ArrayBuffer>
  try {
    keyMaterial = Uint8Array.from(atob(base64Secret), (c) => c.charCodeAt(0))
  } catch {
    return false
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signedContent = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, signedContent)
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)))

  // The header may be a space-separated list of "v1,<sig>" entries.
  const candidates = signatureHeader
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('v1,') ? s.slice(3) : s))

  return candidates.some((candidate) => timingSafeEqual(candidate, expected))
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

// Maps Polar product IDs to our internal tier + cycle. Keep in sync with
// the IDs in wrangler.toml's [vars] section.
type ProductMap = Record<string, { tier: 'pro' | 'studio'; cycle: 'monthly' | 'yearly' }>

export function getProductMap(): ProductMap {
  const proMonthly = process.env.POLAR_PRODUCT_PRO_MONTHLY
  const proYearly = process.env.POLAR_PRODUCT_PRO_YEARLY
  const studioMonthly = process.env.POLAR_PRODUCT_STUDIO_MONTHLY
  const studioYearly = process.env.POLAR_PRODUCT_STUDIO_YEARLY

  const map: ProductMap = {}
  if (proMonthly) map[proMonthly] = { tier: 'pro', cycle: 'monthly' }
  if (proYearly) map[proYearly] = { tier: 'pro', cycle: 'yearly' }
  if (studioMonthly) map[studioMonthly] = { tier: 'studio', cycle: 'monthly' }
  if (studioYearly) map[studioYearly] = { tier: 'studio', cycle: 'yearly' }
  return map
}

export function tierFromProduct(productId: string): { tier: 'pro' | 'studio'; cycle: 'monthly' | 'yearly' } | null {
  return getProductMap()[productId] ?? null
}
