import Image from 'next/image'
import Link from 'next/link'
import AccountNavLink from '@/components/AccountNavLink'

export const metadata = { robots: { index: false, follow: false } }

const SECTIONS = [
  {
    emoji: '⚡',
    title: 'Instant shared albums',
    color: '#254F22',
    items: [
      'Create a shared album in 2 seconds — no account, no sign-up, no app download required',
      'Every album gets a unique shareable link immediately',
      'Anyone with the link can upload photos and videos — no friction for guests',
      'Real-time live gallery: photos uploaded by guests appear instantly for everyone viewing the album, no refresh needed',
      'Photos sorted by upload order with full drag-and-drop reordering for owners',
      'Album title, description, and cover photo all customizable',
    ],
  },
  {
    emoji: '📸',
    title: 'Uploads',
    color: '#7C4A2D',
    items: [
      'Supports photos: JPEG, PNG, WebP, HEIC, AVIF, GIF',
      'Supports videos: MP4, MOV, MKV, WebM, AVI (and more)',
      'Parallel upload engine — 6 files at once, no waiting in a queue',
      'Web Lock API keeps uploads running even when you switch tabs',
      'Warning shown if you try to close the tab while uploading',
      'Up to 100 files saved to the database in a single batch',
      'Poster thumbnails auto-generated for every video (with graceful fallback on mobile)',
      'Free tier: up to 200 MB per video, Pro/Max: up to 500 MB per video',
    ],
  },
  {
    emoji: '🔒',
    title: 'Privacy & security',
    color: '#1A4A6B',
    items: [
      'EXIF metadata (GPS coordinates, device info, timestamps) stripped from all JPEG downloads automatically',
      'Download proxy prevents exposing raw storage URLs in downloads',
      'SSRF protection on all proxy routes — only fetches from your own storage hosts',
      'Password-protected albums (Pro+) — guests must enter a password to view',
      'Owner link system — album management via a secret token, no account needed',
      'No Google Ads, no third-party trackers, no analytics that follow users across the web',
      'Album passwords enforced only for Pro+ owners — no accidental lockout on downgrade',
      'CSRF protection on all state-changing API routes',
    ],
  },
  {
    emoji: '🎨',
    title: 'Customization',
    color: '#5C3A8A',
    items: [
      '20+ background color presets plus full custom hex color picker',
      '12 curated stock photo backgrounds (nature, architecture, texture)',
      'Upload your own custom background image (JPG, PNG, WebP, AVIF — up to 10 MB)',
      'Adjustable media corner radius from sharp to fully round',
      'Media display filters: original, warm, cool, faded, dramatic, mono, vivid',
      'Media hover effects: zoom, lift, glow, flip',
      'Mobile grid columns: 2 or 3 per row',
      'Video autoplay toggle',
      'Slideshow mode with configurable interval (1–30 seconds) and animation (fade, slide, zoom, flip)',
      'Custom album cover photo',
    ],
  },
  {
    emoji: '⏱️',
    title: 'Delayed reveal',
    color: '#1A5C4A',
    items: [
      'Set a future date and time when photos unlock for guests',
      'Guests see a live countdown timer (days, hours, minutes, seconds) instead of the album',
      'Page automatically reloads and reveals the album when the timer hits zero',
      'Owner can always access and manage the album via their owner link — no waiting',
      '"Unlocks on" status card shows formatted date in the owner toolbar',
      'Reveal time is stored in UTC, displayed in each viewer\'s local timezone',
      'Clear the reveal time anytime to make the album public immediately',
    ],
  },
  {
    emoji: '🔍',
    title: 'Face finder (Max)',
    color: '#7C2D3A',
    items: [
      'Powered by AWS Rekognition — industry-leading face recognition (98%+ accuracy)',
      'Guests click "Find my photos", upload a selfie, and instantly see every photo they appear in',
      'Works with group shots, angled faces, different lighting conditions',
      'Similarity percentage shown on each matched photo',
      'Album photos indexed automatically on first search — all subsequent searches are instant',
      'Selfie processed server-side only — never stored permanently',
      'Supports up to 15 faces detected per photo',
      'Matches up to 100 photos per search',
      'Only available on Max-plan albums',
    ],
  },
  {
    emoji: '📥',
    title: 'Downloads',
    color: '#4A3A1A',
    items: [
      'Download individual photos and videos with one click',
      'Bulk ZIP download — the entire album packaged into a single file',
      'ZIP progress bar shows per-file status and failed count',
      'All JPEG downloads have EXIF metadata stripped (GPS, device info, timestamps)',
      'Filenames use captions when available, otherwise include the date (e.g. photo_2024-05-18.jpg)',
      'Videos download at original quality',
    ],
  },
  {
    emoji: '🔗',
    title: 'Sharing',
    color: '#1A3A5C',
    items: [
      'One-tap share button with auto-generated QR code for the album',
      'QR code can be downloaded or displayed on screen at events',
      'Copy link button for both the public album and owner management link',
      'Custom album URLs like hushare.space/your-event-name (Pro+)',
      'Guest share button — guests can share the album link without owner access',
      'Report album button for guests to flag inappropriate content',
    ],
  },
  {
    emoji: '🗂️',
    title: 'Collections (Max)',
    color: '#3A1A5C',
    items: [
      'Group multiple albums under a single public URL at /c/collection-name',
      'Built for photographers, event planners, and families managing many albums',
      'Each collection has its own title, description, and URL slug',
      'Add any album to a collection from the album\'s owner settings',
      'Album count and member albums displayed on the collection page',
    ],
  },
  {
    emoji: '📬',
    title: 'Notifications',
    color: '#5C2A1A',
    items: [
      'Album owners receive email notifications when guests upload photos',
      'Batched intelligently — one email per upload session, not per photo',
      '7-day cooldown between notification emails per album (no spam)',
      'Expiry warning email sent 30 days before a free album is deleted due to inactivity',
      'All emails include physical mailing address and unsubscribe instructions (CAN-SPAM compliant)',
      'Emails sent via Resend with your own verified hushare.space domain',
    ],
  },
  {
    emoji: '🛠️',
    title: 'Owner tools',
    color: '#254F22',
    items: [
      'Full settings panel: background, media, slideshow, password, URL, reveal, collections, and delete',
      'Arrange mode — drag and drop to reorder photos and videos in any order',
      'Bulk select — tap any photo to enter selection mode, select all, delete many at once',
      'Single-photo delete with confirmation',
      'Set any photo as the album cover',
      'Caption editing on individual photos',
      'Per-photo corner radius and filter overrides (independent from album defaults)',
      'Slideshow mode accessible from the owner toolbar with one click',
      'Owner access verification — management links can\'t be used by other accounts',
    ],
  },
  {
    emoji: '📋',
    title: 'Plans',
    color: '#1A2B1A',
    items: [
      'Free: unlimited albums, 12-month inactivity expiry, photos up to 25 MB, videos up to 200 MB',
      'Pro ($4/month): password protection, custom URLs, no expiry, HD video, 200 MB images / 500 MB videos',
      'Max ($10/month): everything in Pro + face finder, collections, priority support',
      'Intro pricing: Pro first month $1.99, Max first month $6.99',
      'Annual plans: Pro $40/year, Max $100/year (2 months free)',
      'Payments via Polar.sh — Stripe-backed, secure checkout',
      'Cancel anytime from the account dashboard',
    ],
  },
  {
    emoji: '⚖️',
    title: 'Legal & compliance',
    color: '#3A2A1A',
    items: [
      'DMCA Designated Agent registered with the U.S. Copyright Office (Registration #DMCA-1072882)',
      'Full DMCA takedown procedure published in Terms of Service',
      'CAN-SPAM compliant emails: physical mailing address + unsubscribe in every email',
      'Privacy policy accurately reflects data practices (no ads, no cross-site tracking)',
      'Subscription auto-renewal disclosures on pricing page (California auto-renewal law compliant)',
      'GDPR/CCPA: no third-party ad tracking, no persistent user profiling',
      'Report system for guests to flag abusive or illegal albums',
      'Terms of Service published and versioned',
    ],
  },
  {
    emoji: '🌐',
    title: 'SEO & performance',
    color: '#1A3A2A',
    items: [
      'Server-side rendered landing, pricing, legal, and SEO pages',
      'Structured data (JSON-LD) on all public pages',
      'Open Graph and Twitter card tags on every page',
      'Auto-generated XML sitemap',
      'Canonical URLs on all pages',
      'Lazy loading on all media in the photo grid',
      'Responsive grid: adapts from 2 to 3 columns based on screen size and owner setting',
      'Dedicated SEO landing pages: event photo sharing, wedding photo sharing, QR code photo album',
    ],
  },
]

export default function InfoPage() {
  return (
    <main className="min-h-screen" style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}>
      <nav
        className="sticky top-0 z-50 flex items-center justify-between hush-nav"
        style={{
          background: 'rgba(253,250,245,0.9)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(221,213,197,0.5)',
        }}
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
        <div className="hush-nav-links">
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>
            Pricing
          </Link>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>
            Collabs
          </Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>
            Support
          </Link>
          <AccountNavLink />
        </div>
      </nav>

      <div className="hush-readable py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] mb-4" style={{ color: '#8B6F4E' }}>
          Hushare — Feature overview
        </p>
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            color: '#254F22',
            fontSize: 'clamp(2.2rem, 5vw, 3.8rem)',
            lineHeight: 1.1,
            fontWeight: 700,
          }}
        >
          Everything Hushare can do
        </h1>
        <p className="mt-4 text-lg leading-relaxed" style={{ color: '#5C4A3C' }}>
          {SECTIONS.reduce((sum, s) => sum + s.items.length, 0)} features across{' '}
          {SECTIONS.length} categories. This page is not indexed by search engines.
        </p>

        <div className="mt-12 space-y-10">
          {SECTIONS.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl p-6"
              style={{ background: '#fff', border: '1px solid #E8E0D0' }}
            >
              <h2
                className="flex items-center gap-2.5 text-xl font-bold mb-5"
                style={{ fontFamily: 'var(--font-serif)', color: section.color }}
              >
                <span>{section.emoji}</span>
                {section.title}
              </h2>
              <ul className="space-y-2.5">
                {section.items.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: section.color, opacity: 0.5 }} />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-12 text-xs text-center" style={{ color: '#C8B89A' }}>
          This page is temporary and not linked from anywhere public. Remove when no longer needed.
        </p>
      </div>
    </main>
  )
}
