'use client'

import { useEffect, useState } from 'react'
import BrandPreloader from '@/components/BrandPreloader'

export default function InitialPreloader() {
  const [phase, setPhase] = useState<'visible' | 'leaving' | 'hidden'>('visible')

  useEffect(() => {
    document.body.classList.add('hush-page-preloading')
    const leaveTimeout = window.setTimeout(() => {
      setPhase('leaving')
      document.body.classList.remove('hush-page-preloading')
      document.body.classList.add('hush-page-loaded')
    }, 2000)
    const hideTimeout = window.setTimeout(() => setPhase('hidden'), 2550)

    return () => {
      window.clearTimeout(leaveTimeout)
      window.clearTimeout(hideTimeout)
      document.body.classList.remove('hush-page-preloading', 'hush-page-loaded')
    }
  }, [])

  if (phase === 'hidden') return null

  return (
    <div className={`hush-initial-preloader hush-initial-preloader-${phase}`}>
      <BrandPreloader label="Loading Hushare" />
    </div>
  )
}
