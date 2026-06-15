import { createAdminClient } from '@/lib/supabase/admin'

type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }

export async function checkRateLimit(
  key: string,
  windowSeconds: number,
  maxRequests: number,
  options?: { failOpen?: boolean },
): Promise<RateLimitResult> {
  const failOpen = options?.failOpen ?? false
  try {
    const admin = createAdminClient()
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString()

    const { count, error: countError } = await admin
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', since)

    if (countError) {
      console.warn('[rate-limit] count failed:', JSON.stringify({ message: countError.message, code: countError.code, details: countError.details, hint: countError.hint }), 'failOpen:', failOpen)
      return failOpen ? { ok: true } : { ok: false, retryAfterSeconds: 60 }
    }

    if (count != null && count >= maxRequests) {
      return { ok: false, retryAfterSeconds: windowSeconds }
    }

    // Record this event (best-effort — don't block the response on errors here).
    const { error: insertError } = await admin
      .from('rate_limit_events')
      .insert({ key })
    if (insertError && !/does not exist/i.test(insertError.message ?? '')) {
      console.warn('[rate-limit] insert failed:', insertError.message)
    }

    return { ok: true }
  } catch (err) {
    console.error('[rate-limit] unexpected error:', err, 'failOpen:', failOpen)
    return failOpen ? { ok: true } : { ok: false, retryAfterSeconds: 60 }
  }
}

export function clientIpKey(req: Request, prefix: string): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return `${prefix}:${cf.trim().slice(0, 64)}`
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return `${prefix}:${xff.split(',')[0].trim().slice(0, 64)}`
  return `${prefix}:unknown`
}
