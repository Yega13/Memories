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
      className="hush-nav sticky top-0 z-50 flex items-center"
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
          className="hush-logo"
          style={{ width: 'auto' }}
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
  const planName = tierLabel ?? 'Studio test access'
  const isStudio = subscription?.tier === 'studio' || !subscription
  const planFeatures = isStudio
    ? ['Studio Collections', 'Custom album backgrounds', 'Password protection', 'Custom URLs', '200 MB uploads']
    : ['Custom album backgrounds', 'Password protection', 'Custom URLs', '200 MB uploads']
  const nextLabel = subscription?.cancel_at_period_end ? 'Access ends' : 'Next renewal'

  return (
    <div className="min-h-screen" style={{ background: '#FDFAF5' }}>
      <AccountNav />
      <main className="px-4 py-10 sm:py-14">
        <div className="hush-container">
          <section
            className="hush-fade-up rounded-2xl p-6 sm:p-8 mb-6"
            style={{
              background: '#FFFFFF',
              border: '1px solid #DDD5C5',
              boxShadow: '0 4px 32px rgba(37,79,34,0.10)',
            }}
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs mb-3 uppercase tracking-[0.18em]" style={{ color: '#8B6F4E', fontWeight: 600 }}>
                  Account
                </p>
                <h1
                  className="text-3xl sm:text-4xl font-bold mb-3"
                  style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
                >
                  Your Hushare workspace
                </h1>
                <p className="text-sm break-all" style={{ color: '#5C4A3C' }}>
                  Signed in as <strong>{user.email}</strong>
                </p>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: '#F5F0E8', border: '1px solid #DDD5C5' }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>
                  Current access
                </p>
                <p className="font-semibold" style={{ color: '#254F22' }}>{planName}</p>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
            <section
              className="hush-hover-lift rounded-2xl p-6"
              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(37,79,34,0.08)' }}
            >
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>Plan</p>
                  <h2 className="text-xl font-semibold" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>
                    {planName}
                  </h2>
                </div>
                <span className="rounded-full px-3 py-1 text-xs font-semibold capitalize" style={{ background: '#EAF0E8', color: '#254F22' }}>
                  {subscription?.status ?? 'admin'}
                </span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-5" style={{ color: '#5C4A3C' }}>
                <div className="rounded-xl p-4" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                  <dt className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>Uploads</dt>
                  <dd className="font-semibold" style={{ color: '#254F22' }}>{subscription ? 'Up to 200 MB' : 'Studio limits enabled'}</dd>
                </div>
                <div className="rounded-xl p-4" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                  <dt className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>{periodEnd ? nextLabel : 'Billing'}</dt>
                  <dd className="font-semibold" style={{ color: '#254F22' }}>{periodEnd ?? 'No active paid subscription'}</dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                {planFeatures.map((feature) => (
                  <span key={feature} className="rounded-full px-3 py-1 text-xs" style={{ background: '#F5F0E8', color: '#5C4A3C', border: '1px solid #E8E0D2' }}>
                    {feature}
                  </span>
                ))}
              </div>

              {subscription && (
                <form action="/api/portal" method="POST" className="mt-6">
                  <button
                    type="submit"
                    className="w-full font-semibold rounded-xl py-3 text-sm transition hover:opacity-90"
                    style={{ background: '#254F22', color: '#FDFAF5' }}
                  >
                    Manage subscription
                  </button>
                </form>
              )}
            </section>

            <section
              className="hush-hover-lift rounded-2xl p-6"
              style={{ background: '#FBF4E4', border: '1px solid rgba(196,166,120,0.35)' }}
            >
              <p className="text-xs uppercase tracking-wide mb-2" style={{ color: '#8B6F4E' }}>What to keep handy</p>
              <h2 className="text-xl font-semibold mb-3" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>
                Owner links still matter
              </h2>
              <p className="text-sm leading-relaxed mb-5" style={{ color: '#5C4A3C' }}>
                Album ownership is still proven by the owner link. Save it after creating an album, especially before sharing the public link with guests.
              </p>
              <Link
                href="/"
                className="inline-flex w-full items-center justify-center rounded-xl py-3 text-sm font-semibold transition hover:opacity-90"
                style={{ background: '#254F22', color: '#FDFAF5' }}
              >
                Create a new album
              </Link>
            </section>
          </div>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 mb-6">
            {[
              ['Customize albums', 'Change album colors and stock backgrounds from each owner toolbar.'],
              ['Protect important links', 'Use passwords and custom URLs on Pro and Studio albums.'],
              [isStudio ? 'Build Collections' : 'Upgrade for Collections', isStudio ? 'Create public /c/... pages that group related albums.' : 'Collections are available on Studio.'],
            ].map(([title, copy]) => (
              <div key={title} className="hush-hover-lift rounded-2xl p-5" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
                <h3 className="font-semibold mb-2" style={{ color: '#254F22' }}>{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>{copy}</p>
              </div>
            ))}
          </section>

          <div className="max-w-sm">
            <SignOutButton />
          </div>
        </div>
      </main>
    </div>
  )
}
