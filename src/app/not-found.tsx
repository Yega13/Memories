import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
}

export default function NotFound() {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: '#FDFAF5' }}
    >
      <p
        className="text-7xl font-bold mb-4"
        style={{ color: '#254F22', fontFamily: 'var(--font-serif)', opacity: 0.18 }}
      >
        404
      </p>
      <h1
        className="text-2xl font-bold mb-3"
        style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
      >
        Page not found
      </h1>
      <p className="text-sm mb-8 max-w-sm" style={{ color: '#5C4A3C' }}>
        This page doesn&apos;t exist. If you were looking for an album, double-check the link.
      </p>
      <Link
        href="/"
        className="rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"
        style={{ background: '#254F22', color: '#FDFAF5' }}
      >
        Go home
      </Link>
    </main>
  )
}
