import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { canAccessAccount } from '@/lib/auth'
import SignOutButton from './SignOutButton'

export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Account',
  description: 'Manage your Hushare subscription.',
  robots: { index: false, follow: false },
}

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/account')
  }

  // Gate: only admins (and, eventually, active Pro/Studio subscribers) get in.
  if (!canAccessAccount(user)) {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-4 py-16"
        style={{ background: '#FDFAF5' }}
      >
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
    )
  }

  return (
    <main className="min-h-screen px-4 py-16" style={{ background: '#FDFAF5' }}>
      <div className="max-w-md mx-auto">
        <h1
          className="text-3xl font-bold mb-6"
          style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
        >
          Account
        </h1>

        <section
          className="rounded-2xl p-6 mb-6"
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

        <SignOutButton />
      </div>
    </main>
  )
}
