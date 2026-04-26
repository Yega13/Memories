import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import SignOutButton from './SignOutButton'

export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Your account',
  description: 'Manage your Hushare account.',
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

  return (
    <main className="min-h-screen px-4 py-16" style={{ background: '#FDFAF5' }}>
      <div className="max-w-md mx-auto">
        <h1
          className="text-3xl font-bold mb-6"
          style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
        >
          Your account
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

        <section
          className="rounded-2xl p-6 mb-6"
          style={{
            background: '#FBF4E4',
            border: '1px solid rgba(196,166,120,0.35)',
          }}
        >
          <p
            className="text-xs uppercase mb-2"
            style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}
          >
            Pro &amp; Studio waitlist
          </p>
          <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
            You&apos;re on the list. Pro and Studio plans are launching soon — we&apos;ll email
            you at <strong className="break-all">{user.email}</strong> the moment they go live,
            with the launch pricing locked in for your first year.
          </p>
          <Link
            href="/pricing"
            className="inline-block mt-4 text-sm font-semibold hover:underline"
            style={{ color: '#254F22' }}
          >
            See what&apos;s coming →
          </Link>
        </section>

        <SignOutButton />
      </div>
    </main>
  )
}
