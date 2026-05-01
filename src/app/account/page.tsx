import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { hasAccountAccess } from '@/lib/access'
import { getActiveSubscription } from '@/lib/subscriptions'
import SignOutButton from './SignOutButton'
import SubscriptionPolling from './SubscriptionPolling'

// Sticky page nav — matches /pricing, /support, /privacy. Logo links home.
function AccountNav() {
  return (
    <nav
      className="sticky top-0 z-50 flex items-center px-5 sm:px-8 py-4"
      style={{
        background: 'rgba(253, 250, 245, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(221, 213, 197, 0.5)',
      }}
    >
      <Link href="/" className="flex items-center transition hover:opacity-70" aria-label="Hushare home">
        <Image
          src="/logo/logo-dark-transparent.png"
          alt="Hushare"
          width={618}
          height={146}
          style={{ height: '28px', width: 'auto' }}
        />
      </Link>
    </nav>
  )
}

export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Account',
  description: 'Manage your Hushare subscription.',
  robots: { index: false, follow: false },
}

type Props = {
  searchParams: Promise<{ welcome?: string }>
}

export default async function AccountPage({ searchParams }: Props) {
  const { welcome } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/account')
  }

  // Gate: admins and active Pro/Studio subscribers only.
  if (!(await hasAccountAccess(user))) {
    // Customers freshly redirected from Polar checkout (?welcome=1) might
    // arrive before our webhook has had a chance to upsert their row.
    // Show a polling state instead of a bare 403 — the row almost always
    // arrives within a few seconds.
    if (welcome === '1') {
      return <SubscriptionPolling email={user.email ?? ''} />
    }
    return (
      <div className="min-h-screen" style={{ background: '#FDFAF5' }}>
        <AccountNav />
        <main className="flex items-center justify-center px-4 py-16">
          <div
            className="max-w-md w-full rounded-2xl p-8 text-center"
            style={{
              background: '#FFFFFF',
              border: '1px solid #DDD5C5',
              boxShadow: '0 4px 32px rgba(37,79,34,0.10)',
            }}
          >
            <p
              className="text-xs uppercase mb-3"
              style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}
            >
              403 — Forbidden
            </p>
            <h1
              className="text-2xl font-bold mb-3"
              style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
            >
              No account dashboard yet
            </h1>
            <p className="text-sm leading-relaxed mb-5" style={{ color: '#5C4A3C' }}>
              The account dashboard is reserved for Hushare Pro and Studio subscribers.
              You&apos;re signed in as <strong className="break-all">{user.email}</strong>,
              but you don&apos;t have an active subscription.
            </p>
            <SignOutButton />
          </div>
        </main>
      </div>
    )
  }

  const subscription = await getActiveSubscription(user.id)
  const tierLabel = subscription
    ? subscription.tier === 'pro'
      ? 'Hushare Pro'
      : 'Hushare Studio'
    : null
  const periodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <div className="min-h-screen" style={{ background: '#FDFAF5' }}>
      <AccountNav />
      <main className="px-4 py-16">
        <div className="max-w-md mx-auto">
        <h1
          className="text-3xl font-bold mb-6"
          style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
        >
          Account
        </h1>

        <section
          className="rounded-2xl p-6 mb-4"
          style={{
            background: '#FFFFFF',
            border: '1px solid #DDD5C5',
            boxShadow: '0 4px 32px rgba(37,79,34,0.10)',
          }}
        >
          <p className="text-xs mb-1 uppercase tracking-wide" style={{ color: '#8B6F4E' }}>
            Signed in as
          </p>
          <p className="text-base font-medium break-all" style={{ color: '#254F22' }}>
            {user.email}
          </p>
        </section>

        {subscription ? (
          <section
            className="rounded-2xl p-6 mb-6"
            style={{
              background: '#FFFFFF',
              border: '1px solid #DDD5C5',
              boxShadow: '0 4px 32px rgba(37,79,34,0.10)',
            }}
          >
            <p className="text-xs mb-1 uppercase tracking-wide" style={{ color: '#8B6F4E' }}>
              Subscription
            </p>
            <p className="text-base font-medium mb-3" style={{ color: '#254F22' }}>
              {tierLabel}
            </p>
            <dl className="text-sm space-y-1" style={{ color: '#5C4A3C' }}>
              <div className="flex justify-between">
                <dt>Status</dt>
                <dd className="font-medium capitalize">
                  {subscription.cancel_at_period_end && subscription.status === 'active'
                    ? 'Active (cancels at period end)'
                    : subscription.status}
                </dd>
              </div>
              {periodEnd && (
                <div className="flex justify-between">
                  <dt>{subscription.cancel_at_period_end ? 'Ends' : 'Renews'}</dt>
                  <dd className="font-medium">{periodEnd}</dd>
                </div>
              )}
            </dl>
            <form action="/api/portal" method="POST" className="mt-5">
              <button
                type="submit"
                className="w-full font-semibold rounded-xl py-2.5 text-sm transition hover:opacity-90"
                style={{ background: '#254F22', color: '#FDFAF5' }}
              >
                Manage subscription
              </button>
            </form>
          </section>
        ) : (
          <section
            className="rounded-2xl p-6 mb-6"
            style={{
              background: '#FBF4E4',
              border: '1px solid rgba(196,166,120,0.35)',
            }}
          >
            <p className="text-sm" style={{ color: '#5C4A3C' }}>
              Admin access (no active subscription).
            </p>
          </section>
        )}

        <SignOutButton />
        </div>
      </main>
    </div>
  )
}
