'use client'

import { useState } from 'react'
import { Send, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type Status = 'idle' | 'sending' | 'sent' | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'sending') return

    const trimmed = email.trim()
    if (!EMAIL_RE.test(trimmed)) {
      setStatus('error')
      setErrorMsg('Please enter a valid email')
      return
    }

    setStatus('sending')
    setErrorMsg('')

    // Preserve a same-origin `?next=` so the user lands where they intended
    // after clicking the magic link. Reject absolute or protocol-relative
    // values so `?next=//evil.com` can't redirect off-site.
    const params = new URLSearchParams(window.location.search)
    const rawNext = params.get('next') ?? ''
    const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : ''
    const callbackUrl = new URL('/auth/callback', window.location.origin)
    if (safeNext) callbackUrl.searchParams.set('next', safeNext)

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: callbackUrl.toString(),
      },
    })

    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
      return
    }

    setStatus('sent')
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16" style={{ background: '#FDFAF5' }}>
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

        {status === 'sent' ? (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: '#EAF0E8', border: '1px solid #C8D6C2' }}
          >
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3" style={{ color: '#254F22' }} />
            <h3
              className="text-xl font-bold mb-2"
              style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
            >
              Check your inbox
            </h3>
            <p className="text-sm mb-1" style={{ color: '#5C4A3C' }}>
              We sent a sign-in link to <strong>{email}</strong>.
            </p>
            <p className="text-xs mt-3" style={{ color: '#8B6F4E' }}>
              The link expires in 1 hour. If you don&apos;t see it, check your spam folder.
            </p>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="rounded-2xl p-6 sm:p-8"
            style={{
              background: '#FFFFFF',
              border: '1px solid #DDD5C5',
              boxShadow: '0 4px 32px rgba(37,79,34,0.10)',
            }}
          >
            <label
              htmlFor="email"
              className="block text-sm font-medium mb-2"
              style={{ color: '#8B6F4E' }}
            >
              Your email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              maxLength={120}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl px-4 py-3 mb-4 focus:outline-none transition text-base"
              style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
            />

            {status === 'error' && (
              <div
                className="flex items-start gap-3 mb-4 rounded-xl px-4 py-3"
                style={{ background: '#FBEAE6', border: '1px solid #E8C2B8' }}
              >
                <AlertCircle className="w-4 h-4 flex-none mt-0.5" style={{ color: '#C0392B' }} />
                <p className="text-sm" style={{ color: '#7A2A1F' }}>
                  {errorMsg}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50"
              style={{ background: '#254F22', color: '#FDFAF5' }}
            >
              {status === 'sending' ? (
                'Sending link...'
              ) : (
                <>
                  Send magic link <Send className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
