import Image from 'next/image'
import Link from 'next/link'

export default function SiteFooter() {
  return (
    <footer
      className="hush-footer mt-auto py-6 flex flex-col md:flex-row items-center md:justify-between gap-3 text-sm"
      style={{ background: '#FDFAF5', borderTop: '1px solid #E8E0D0' }}
    >
      <Link href="/" className="flex items-center" aria-label="Hushare home">
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
      <div className="hush-footer-links">
        <Link href="/" style={{ color: '#7C5C3E' }}>Home</Link>
        <Link href="/pricing" style={{ color: '#7C5C3E' }}>Pricing</Link>
        <Link href="/shared-photo-album" style={{ color: '#7C5C3E' }}>Shared albums</Link>
        <Link href="/wedding-photo-sharing" style={{ color: '#7C5C3E' }}>Weddings</Link>
        <Link href="/event-photo-sharing" style={{ color: '#7C5C3E' }}>Events</Link>
        <Link href="/qr-code-photo-album" style={{ color: '#7C5C3E' }}>QR albums</Link>
        <Link href="/support" style={{ color: '#7C5C3E' }}>Support</Link>
        <Link href="/privacy" style={{ color: '#7C5C3E' }}>Privacy</Link>
        <Link href="/terms" style={{ color: '#7C5C3E' }}>Terms</Link>
        <span style={{ color: '#B0A090' }}>(c) {new Date().getFullYear()} - your moments, always.</span>
      </div>
    </footer>
  )
}
