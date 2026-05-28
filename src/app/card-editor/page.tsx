import { Suspense } from 'react'
import type { Metadata } from 'next'
import CardEditorWrapper from './CardEditorWrapper'

export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Card Editor — Hushare',
  robots: { index: false, follow: false },
}

export default function CardEditorPage() {
  return (
    <Suspense>
      <CardEditorWrapper />
    </Suspense>
  )
}
