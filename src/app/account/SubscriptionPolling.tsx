'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 15 // 30 seconds total

// Rendered when a user lands on /account?welcome=1 but the Polar webhook
// hasn't yet upserted their subscription row. Polls /api/me every 2s; the
// moment canAccessAccount flips true, calls router.refresh() so the server
// component re-renders with the subscription details. Falls through after
// 30s with a friendlier message than a bare 403.
export default function SubscriptionPolling({ email }: { email: string }) {
  const router = useRouter()
  const [givenUp, setGivenUp] = useState(false)
  const pollsRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    const id = window.setInterval(async () => {
      pollsRef.current += 1
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          const me = (await res.json()) as { canAccessAccount: boolean }
          if (me.canAccessAccount) {
            router.refresh()
            return
          }
        }
      } catch {
        // Network blip — try again next tick.
      }
      if (pollsRef.current >= MAX_POLLS && !cancelled) {
        setGivenUp(true)
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [router])

  if (givenUp) {
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
            Almost there
          </p>
          <h1
            className="text-2xl font-bold mb-3"
            style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
          >
            We&apos;re still confirming your subscription
          </h1>
          <p className="text-sm leading-relaxed mb-5" style={{ color: '#5C4A3C' }}>
            Your payment went through, but our system is taking a moment to catch
            up. This usually clears within a minute or two — try refreshing this
            page shortly. If it&apos;s still not showing in 5 minutes, email{' '}
            <a
              href="mailto:hello@hushare.space"
              style={{
                color: '#254F22',
                textDecoration: 'underline',
                textDecorationStyle: 'dotted',
              }}
            >
              hello@hushare.space
            </a>{' '}
            from <strong className="break-all">{email}</strong> and we&apos;ll
            sort it immediately.
          </p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="w-full font-semibold rounded-xl py-2.5 text-sm transition hover:opacity-90"
            style={{ background: '#254F22', color: '#FDFAF5' }}
          >
            Refresh
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-16"
      style={{ background: '#FDFAF5' }}
    >
      <div
        className="max-w-md w-full rounded-2xl p-10 text-center"
        style={{
          background: '#FFFFFF',
          border: '1px solid #DDD5C5',
          boxShadow: '0 4px 32px rgba(37,79,34,0.10)',
        }}
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-5"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '3px solid #DDD5C5',
            borderTopColor: '#254F22',
            animation: 'spin 0.9s linear infinite',
          }}
        />
        <h1
          className="text-xl font-bold mb-2"
          style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
        >
          Confirming your subscription…
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
          Thanks for subscribing. We&apos;re finalising things on our end — this
          usually takes a few seconds.
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </main>
  )
}
