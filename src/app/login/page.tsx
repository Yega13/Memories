import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import LoginForm from './LoginForm'

export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Hushare account with a magic link — no password needed.',
  robots: { index: false, follow: false },
}

type Props = {
  searchParams: Promise<{ next?: string }>
}

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/account'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Already signed in — skip the form, send them where they intended to go.
  if (user) {
    redirect(safeNext)
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-16"
      style={{ background: '#FDFAF5' }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
          >
            Sign in to Hushare
          </h1>
          <p className="text-sm" style={{ color: '#5C4A3C' }}>
            We&apos;ll email you a magic link — no password needed.
          </p>
        </div>

        <LoginForm />
      </div>
    </main>
  )
}
