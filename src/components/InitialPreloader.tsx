'use client'

import { useEffect, useState } from 'react'
import BrandPreloader from '@/components/BrandPreloader'

export default function InitialPreloader() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [])

  if (!visible) return null

  return (
    <div className="hush-initial-preloader">
      <BrandPreloader label="Loading Hushare" />
    </div>
  )
}
