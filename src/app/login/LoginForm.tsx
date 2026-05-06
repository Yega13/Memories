'use client'

import { useState } from 'react'
import { Send, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type Status = 'idle' | 'sending' | 'sent' | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Preserve a same-origin `?next=` so the user lands where they intended after
// the OAuth round-trip or magic-link click. Reject absolute or protocol-relative
// values so `?next=//evil.com` can't redirect off-site.
function buildCallbackUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const rawNext = params.get('next') ?? ''
  const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : ''
  const url = new URL('/auth/callback', window.location.origin)
  if (safeNext) url.searchParams.set('next', safeNext)
  return url.toString()
}

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [oauthBusy, setOauthBusy] = useState(false)

  async function onGoogle() {
    if (oauthBusy || status === 'sending') return
    setOauthBusy(true)
    setErrorMsg('')
    setStatus('idle')

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: buildCallbackUrl() },
    })

    // On success the browser is already navigating to Google's consent page.
    if (error) {
      setOauthBusy(false)
      setStatus('error')
      setErrorMsg(error.message)
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'sending' || oauthBusy) return

    const trimmed = email.trim()
    if (!EMAIL_RE.test(trimmed)) {
      setStatus('error')
      setErrorMsg('Please enter a valid email')
      return
    }

    setStatus('sending')
    setErrorMsg('')

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: buildCallbackUrl() },
    })

    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
      return
    }

    setStatus('sent')
  }

  if (status === 'sent') {
    return (
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
    )
  }

  return (
    <div
      className="rounded-2xl p-6 sm:p-8"
      style={{
        background: '#FFFFFF',
        border: '1px solid #DDD5C5',
        boxShadow: '0 4px 32px rgba(37,79,34,0.10)',
      }}
    >
      <button
        type="button"
        onClick={onGoogle}
        disabled={oauthBusy || status === 'sending'}
        className="w-full flex items-center justify-center gap-3 font-medium rounded-xl py-3 transition hover:bg-[#FDFAF5] disabled:opacity-50"
        style={{ background: '#FFFFFF', color: '#254F22', border: '1px solid #DDD5C5' }}
      >
        <GoogleIcon />
        {oauthBusy ? 'Redirecting…' : 'Continue with Google'}
      </button>

      <div className="flex items-center gap-3 my-5" aria-hidden="true">
        <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        <span className="text-xs uppercase tracking-wider" style={{ color: '#8B6F4E' }}>
          or
        </span>
        <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
      </div>

      <form onSubmit={onSubmit}>
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
          disabled={status === 'sending' || oauthBusy}
          className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50"
          style={{ background: '#254F22', color: '#FDFAF5' }}
        >
          {status === 'sending' ? (
            'Sending link…'
          ) : (
            <>
              Send magic link <Send className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}
