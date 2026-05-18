'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'

type Props = {
  revealAt: string
  title: string
  onUnlocked: () => void
}

type TimeLeft = {
  days: number
  hours: number
  minutes: number
  seconds: number
  total: number
}

function getTimeLeft(revealAt: string): TimeLeft {
  const total = Math.max(0, new Date(revealAt).getTime() - Date.now())
  const seconds = Math.floor((total / 1000) % 60)
  const minutes = Math.floor((total / 1000 / 60) % 60)
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24)
  const days = Math.floor(total / (1000 * 60 * 60 * 24))
  return { days, hours, minutes, seconds, total }
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export default function RevealCountdown({ revealAt, title, onUnlocked }: Props) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => getTimeLeft(revealAt))

  useEffect(() => {
    if (timeLeft.total === 0) {
      onUnlocked()
      return
    }
    const id = setInterval(() => {
      const next = getTimeLeft(revealAt)
      setTimeLeft(next)
      if (next.total === 0) {
        clearInterval(id)
        onUnlocked()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [revealAt, onUnlocked, timeLeft.total])

  const revealDate = new Date(revealAt)
  const formattedDate = revealDate.toLocaleString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: '#1A2B1A' }}
    >
      <div className="flex flex-col items-center gap-10 max-w-sm w-full text-center">
        <Image
          src="/logo/logo-dark-transparent.png"
          alt="Hushare"
          width={618}
          height={146}
          className="hush-logo"
          style={{ width: 'auto', maxWidth: '140px', filter: 'brightness(0) invert(1)', opacity: 0.55 }}
          draggable={false}
        />

        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.22em] mb-4"
            style={{ color: '#5C7A59' }}
          >
            Photos coming soon
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              color: '#FDFAF5',
              fontSize: 'clamp(1.6rem, 5vw, 2.6rem)',
              lineHeight: 1.15,
              fontWeight: 700,
            }}
          >
            {title}
          </h1>
        </div>

        <div className="w-full">
          <div className="flex items-end justify-center gap-1">
            {timeLeft.days > 0 && (
              <>
                <Unit value={timeLeft.days} label="days" />
                <Sep />
              </>
            )}
            <Unit value={timeLeft.hours} label="hrs" />
            <Sep />
            <Unit value={timeLeft.minutes} label="min" />
            <Sep />
            <Unit value={timeLeft.seconds} label="sec" />
          </div>
        </div>

        <div
          className="w-full rounded-2xl px-5 py-4 text-left"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: '#3D5C3A' }}>
            Reveals on
          </p>
          <p className="text-sm font-medium" style={{ color: '#A8C9A3' }}>
            {formattedDate}
          </p>
        </div>

        <p className="text-[11px]" style={{ color: '#2E4A2C' }}>
          This page will reload automatically when the time arrives.
        </p>
      </div>
    </div>
  )
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center" style={{ minWidth: '4.5rem' }}>
      <span
        className="font-mono font-bold tabular-nums"
        style={{ fontSize: 'clamp(2.8rem, 10vw, 5rem)', color: '#FDFAF5', lineHeight: 1, letterSpacing: '-0.02em' }}
      >
        {pad(value)}
      </span>
      <span className="text-[10px] uppercase tracking-widest mt-1" style={{ color: '#3D5C3A' }}>
        {label}
      </span>
    </div>
  )
}

function Sep() {
  return (
    <span
      className="font-mono font-bold"
      style={{ fontSize: 'clamp(2rem, 8vw, 4rem)', color: 'rgba(61,92,58,0.5)', lineHeight: 1, paddingBottom: '1.6rem', margin: '0 2px' }}
    >
      :
    </span>
  )
}
