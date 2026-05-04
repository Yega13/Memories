'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const footerLinks = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/shared-photo-album', label: 'Shared albums' },
  { href: '/wedding-photo-sharing', label: 'Weddings' },
  { href: '/event-photo-sharing', label: 'Events' },
  { href: '/qr-code-photo-album', label: 'QR albums' },
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

export default function SiteFooter() {
  const pathname = usePathname()
  const visibleLinks = footerLinks.filter((link) => link.href !== pathname)

  return (
    <footer
      className="hush-footer mt-auto py-6 flex flex-col md:flex-row items-center md:justify-between gap-3 text-sm"
      style={{ background: '#FDFAF5', borderTop: '1px solid #E8E0D0' }}
    >
      <Link href="/" className="hush-footer-logo flex items-center" aria-label="Hushare home">
        <Image
          src="/logo/logo-dark-transparent.png"
          alt="Hushare"
          width={618}
          height={146}
          className="hush-logo"
          style={{ width: 'auto' }}
          draggable={false}
        />
      </Link>
      <nav className="hush-footer-links" aria-label="Footer">
        {visibleLinks.map((link) => (
          <Link key={link.href} href={link.href} className="hush-footer-link" style={{ color: '#7C5C3E' }}>
            {link.label}
          </Link>
        ))}
        <span className="hush-footer-note" style={{ color: '#B0A090' }}>
          (c) {new Date().getFullYear()} - your moments, always.
        </span>
      </nav>
    </footer>
  )
}
