import { createAdminClient } from '@/lib/supabase/admin'

type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }

/**
 * Sliding-window rate limiter backed by the `rate_limit_events` Supabase table.
 * Fails open: if the table doesn't exist yet or any DB error occurs, the request is allowed.
 * Apply the migration in supabase/migrations/20260522_rate_limit_events.sql to activate.
 */
export async function checkRateLimit(
  key: string,
  windowSeconds: number,
  maxRequests: number,
): Promise<RateLimitResult> {
  try {
    const admin = createAdminClient()
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString()

    const { count, error: countError } = await admin
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', since)

    if (countError) {
      // Table missing or other DB error — fail open so rate limiting never breaks the feature.
      if (/does not exist|undefined/i.test(countError.message ?? '')) return { ok: true }
      console.warn('[rate-limit] count failed:', countError.message)
      return { ok: true }
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
  } catch {
    return { ok: true }
  }
}

export function clientIpKey(req: Request, prefix: string): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return `${prefix}:${cf.trim().slice(0, 64)}`
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return `${prefix}:${xff.split(',')[0].trim().slice(0, 64)}`
  return `${prefix}:unknown`
}
