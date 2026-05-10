'use client'

import { useEffect, useState } from 'react'
import BrandPreloader from '@/components/BrandPreloader'

const SEEN_KEY = 'hushare.initialPreloaderSeen'

export default function InitialPreloader() {
  const [phase, setPhase] = useState<'checking' | 'visible' | 'leaving' | 'hidden'>('checking')

  useEffect(() => {
    if (window.sessionStorage.getItem(SEEN_KEY) === '1') {
      setPhase('hidden')
      return
    }

    window.sessionStorage.setItem(SEEN_KEY, '1')
    setPhase('visible')
    document.body.classList.add('hush-page-preloading')

    const leaveTimeout = window.setTimeout(() => {
      setPhase('leaving')
      document.body.classList.remove('hush-page-preloading')
      document.body.classList.add('hush-page-loaded')
    }, 1750)
    const hideTimeout = window.setTimeout(() => setPhase('hidden'), 2310)

    return () => {
      window.clearTimeout(leaveTimeout)
      window.clearTimeout(hideTimeout)
      document.body.classList.remove('hush-page-preloading')
    }
  }, [])

  if (phase === 'checking' || phase === 'hidden') return null

  return (
    <div className={`hush-initial-preloader hush-initial-preloader-${phase}`}>
      <BrandPreloader label="Loading Hushare" />
    </div>
  )
}
