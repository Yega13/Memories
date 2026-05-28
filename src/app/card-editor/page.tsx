import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import type { Metadata } from 'next'

export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Card Editor — Hushare',
  robots: { index: false, follow: false },
}

const CardEditorClient = dynamic(() => import('./CardEditorClient'), { ssr: false })

export default function CardEditorPage() {
  return (
    <Suspense>
      <CardEditorClient />
    </Suspense>
  )
}
