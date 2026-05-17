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

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-8 px-6 text-center"
      style={{ background: '#1A2B1A' }}
    >
      <Image
        src="/logo/logo-dark-transparent.png"
        alt="Hushare"
        width={618}
        height={146}
        className="hush-logo opacity-80"
        style={{ width: 'auto', filter: 'brightness(0) invert(1)' }}
        draggable={false}
      />

      <div>
        <p
          className="text-sm font-semibold uppercase tracking-[0.18em] mb-3"
          style={{ color: '#7BAF76', letterSpacing: '0.2em' }}
        >
          Coming soon
        </p>
        <h1
          className="text-3xl font-bold mb-2"
          style={{ fontFamily: 'var(--font-serif)', color: '#FDFAF5', fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}
        >
          {title}
        </h1>
        <p className="text-sm" style={{ color: '#A8C9A3' }}>
          Photos will be revealed when the countdown ends.
        </p>
      </div>

      <div className="flex items-end gap-4">
        {timeLeft.days > 0 && (
          <Unit value={timeLeft.days} label="days" />
        )}
        <Unit value={timeLeft.hours} label="hours" />
        <Separator />
        <Unit value={timeLeft.minutes} label="min" />
        <Separator />
        <Unit value={timeLeft.seconds} label="sec" />
      </div>

      <p className="text-xs max-w-xs" style={{ color: '#5C7A59' }}>
        The page will automatically load once the time is up.
      </p>
    </div>
  )
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="font-mono font-bold tabular-nums"
        style={{ fontSize: 'clamp(2.4rem, 7vw, 4.5rem)', color: '#FDFAF5', lineHeight: 1 }}
      >
        {pad(value)}
      </span>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: '#5C7A59' }}>
        {label}
      </span>
    </div>
  )
}

function Separator() {
  return (
    <span
      className="font-mono font-bold pb-6"
      style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)', color: '#3A5F38', lineHeight: 1 }}
    >
      :
    </span>
  )
}
