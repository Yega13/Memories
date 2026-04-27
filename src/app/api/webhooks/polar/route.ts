import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature, tierFromProduct } from '@/lib/polar'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type PolarSubscription = {
  id: string
  status: string
  customer_id: string
  product_id: string
  current_period_end: string | null
  cancel_at_period_end?: boolean
  ended_at?: string | null
  metadata?: { userId?: string; tier?: string; cycle?: string }
}

type PolarEvent = {
  type: string
  data: PolarSubscription
}

export async function POST(req: Request) {
  const secret = process.env.POLAR_WEBHOOK_SECRET
  if (!secret) {
    console.error('[polar/webhook] POLAR_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }

  // The signature is computed over the *raw* body bytes — read once and verify
  // before parsing. Re-parsing the same string into JSON below is fine.
  const rawBody = await req.text()

  const ok = await verifyWebhookSignature(rawBody, req.headers, secret)
  if (!ok) {
    console.warn('[polar/webhook] signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401, headers: NO_STORE })
  }

  let event: PolarEvent
  try {
    event = JSON.parse(rawBody) as PolarEvent
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400, headers: NO_STORE })
  }

  // We only act on subscription lifecycle events. Other events (e.g. order.created)
  // are acknowledged with 200 so Polar doesn't retry them — they're not errors,
  // just outside this handler's scope.
  if (!event.type?.startsWith('subscription.')) {
    return NextResponse.json({ ok: true, ignored: event.type }, { headers: NO_STORE })
  }

  const sub = event.data
  if (!sub?.id) {
    return NextResponse.json({ error: 'Missing subscription data' }, { status: 400, headers: NO_STORE })
  }

  // user_id is set as metadata at checkout creation time. If it's missing,
  // the row would be orphaned — log loudly and 200 so Polar doesn't retry.
  const userId = sub.metadata?.userId
  if (!userId) {
    console.error('[polar/webhook] subscription has no userId metadata:', sub.id)
    return NextResponse.json({ ok: true, error: 'no_user_metadata' }, { headers: NO_STORE })
  }

  const tierMatch = tierFromProduct(sub.product_id)
  if (!tierMatch) {
    console.error('[polar/webhook] unknown product_id:', sub.product_id)
    return NextResponse.json({ ok: true, error: 'unknown_product' }, { headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        polar_subscription_id: sub.id,
        polar_customer_id: sub.customer_id,
        polar_product_id: sub.product_id,
        tier: tierMatch.tier,
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end ?? false,
      },
      { onConflict: 'polar_subscription_id' },
    )

  if (error) {
    console.error('[polar/webhook] upsert failed:', error.message, 'event=', event.type)
    // 500 so Polar retries this event later — likely a transient DB issue.
    return NextResponse.json({ error: 'DB write failed' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, type: event.type }, { headers: NO_STORE })
}
