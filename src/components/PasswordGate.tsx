'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'

type Props = {
  // Random slug — what the verify endpoint expects. The visitor may have
  // arrived via a custom slug, but the resolver passes the random slug back
  // in the summary.
  slug: string
  title: string
  onUnlocked: () => void
}

export default function PasswordGate({ slug, title, onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting || !password) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/album/password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, password }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Incorrect password')
        return
      }
      onUnlocked()
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: '#254F22', color: '#FDFAF5' }}
    >
      <div className="w-full max-w-sm">
        <Lock className="w-8 h-8 mx-auto mb-4 opacity-90" />
        <p className="text-xs uppercase mb-2 opacity-75" style={{ letterSpacing: '0.18em' }}>
          Password protected
        </p>
        <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: 'var(--font-serif)' }}>
          {title}
        </h1>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            autoFocus
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl px-4 py-3 focus:outline-none text-base"
            style={{
              background: 'rgba(253,250,245,0.10)',
              border: '1px solid rgba(253,250,245,0.30)',
              color: '#FDFAF5',
            }}
          />
          {error && (
            <p className="text-sm" style={{ color: '#F3D8C7' }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#FDFAF5', color: '#254F22' }}
          >
            {submitting ? 'Checking…' : 'Unlock album'}
          </button>
        </form>
      </div>
    </div>
  )
}
