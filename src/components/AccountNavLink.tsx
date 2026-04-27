'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; canAccess: boolean }

const linkClass = 'text-sm font-medium hover:underline'
const linkStyle = { color: '#254F22' } as const

export default function AccountNavLink() {
  const router = useRouter()
  const [state, setState] = useState<AuthState>({ kind: 'loading' })
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      const { data: sessionData } = await supabase.auth.getSession()
      if (cancelled) return
      if (!sessionData.session?.user) {
        setState({ kind: 'signed-out' })
        return
      }
      // Server-side check covers admin OR active subscriber. Client-side we
      // don't have DB access, so defer to /api/me.
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          const me = (await res.json()) as { canAccessAccount: boolean }
          setState({ kind: 'signed-in', canAccess: me.canAccessAccount })
        } else {
          setState({ kind: 'signed-in', canAccess: false })
        }
      } catch {
        if (!cancelled) setState({ kind: 'signed-in', canAccess: false })
      }
    }

    refresh()

    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      refresh()
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    await supabase.auth.signOut()
    router.refresh()
  }

  // Stable-width placeholder during loading so the nav doesn't reflow.
  if (state.kind === 'loading') {
    return (
      <span className={linkClass} aria-hidden="true" style={{ color: 'transparent' }}>
        Sign in
      </span>
    )
  }

  if (state.kind === 'signed-out') {
    return (
      <Link href="/login" className={linkClass} style={linkStyle}>
        Sign in
      </Link>
    )
  }

  if (state.canAccess) {
    return (
      <Link href="/account" className={linkClass} style={linkStyle}>
        Account
      </Link>
    )
  }

  // Signed in but no Account access (no subscription, not admin). Show
  // sign-out so the user isn't stranded — they have nowhere else to go.
  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className={`${linkClass} disabled:opacity-50`}
      style={linkStyle}
    >
      {signingOut ? 'Signing out...' : 'Sign out'}
    </button>
  )
}
