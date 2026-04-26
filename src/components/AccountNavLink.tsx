'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type AuthState = 'loading' | 'signed-out' | 'signed-in'

export default function AccountNavLink() {
  const [state, setState] = useState<AuthState>('loading')

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setState(data.session ? 'signed-in' : 'signed-out')
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setState(session ? 'signed-in' : 'signed-out')
    })

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  // Render a stable-width placeholder during loading so the nav doesn't reflow.
  if (state === 'loading') {
    return <span className="text-sm font-medium" aria-hidden="true" style={{ color: 'transparent' }}>Sign in</span>
  }

  if (state === 'signed-in') {
    return (
      <Link
        href="/account"
        className="text-sm font-medium hover:underline"
        style={{ color: '#254F22' }}
      >
        Your account
      </Link>
    )
  }

  return (
    <Link
      href="/login"
      className="text-sm font-medium hover:underline"
      style={{ color: '#254F22' }}
    >
      Sign in
    </Link>
  )
}
