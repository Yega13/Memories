'use client'
export const runtime = 'nodejs'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { generateSlug, generateOwnerToken } from '@/lib/utils'
import { ArrowRight, Leaf } from 'lucide-react'

const NATURE_IMG = 'https://live.staticflickr.com/8731/17080622367_6c7109db98_h.jpg'

export default function Home() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createAlbum() {
    if (!title.trim()) { setError('Please give your album a name'); return }
    setLoading(true)
    setError('')
    const slug = generateSlug()
    const ownerToken = generateOwnerToken()
    const { error: dbError } = await supabase.from('albums').insert({ slug, owner_token: ownerToken, title: title.trim() })
    if (dbError) { setError('Something went wrong. Please try again.'); setLoading(false); return }
    router.push(`/${slug}?owner=${ownerToken}`)
  }

  return (
    <main style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }} className="min-h-screen">

      {/* Sticky Nav */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-8 py-5"
        style={{
          background: 'rgba(253, 250, 245, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(221, 213, 197, 0.5)',
        }}
      >
        <div className="flex items-center gap-2">
          <Leaf className="w-5 h-5" style={{ color: '#254F22' }} />
          <span style={{ fontFamily: 'var(--font-serif)', color: '#254F22', fontSize: '1.25rem', fontWeight: 700 }}>
            Husher
          </span>
        </div>
        <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: '#EAF0E8', color: '#254F22' }}>
          Free during beta
        </span>
      </nav>

      {/* ── HERO ── full-bleed, image takes right half with diagonal cut */}
      <div className="relative overflow-hidden" style={{ minHeight: 'calc(100vh - 73px)' }}>

        {/* Nature image — right half, angled clip */}
        <div
          className="absolute inset-y-0 right-0 w-full lg:w-[58%]"
          style={{
            backgroundImage: `url(${NATURE_IMG})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            clipPath: 'polygon(20% 0%, 100% 0%, 100% 100%, 0% 100%)',
          }}
        >
          {/* Dark green overlay so text on top stays readable */}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(37,79,34,0.45) 0%, rgba(27,58,107,0.25) 100%)' }} />
        </div>

        {/* Soft feather where image meets beige */}
        <div
          className="absolute inset-y-0 hidden lg:block"
          style={{
            left: '36%',
            width: '130px',
            background: 'linear-gradient(to right, #FDFAF5, transparent)',
            zIndex: 2,
          }}
        />

        {/* Hero content grid */}
        <div className="relative z-10 max-w-6xl mx-auto px-8 pt-16 pb-24 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center" style={{ minHeight: 'calc(100vh - 73px)' }}>

          {/* Left — text + form */}
          <div>
            <p className="text-sm font-medium uppercase mb-5" style={{ color: '#8B6F4E', letterSpacing: '0.15em' }}>
              No account · No friction
            </p>
            <h1 style={{ fontFamily: 'var(--font-serif)', color: '#254F22', fontSize: 'clamp(2.8rem, 5vw, 4rem)', lineHeight: 1.1, fontWeight: 700, marginBottom: '1.5rem' }}>
              Every moment,<br />
              <em style={{ color: '#7C4A2D' }}>beautifully kept</em>
            </h1>
            <p className="text-lg leading-relaxed mb-10" style={{ color: '#6B5A4E', maxWidth: '420px' }}>
              Create a shared album and let anyone add photos with just a link — no sign-up, no app download.
            </p>

            <div className="rounded-2xl p-6" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(37,79,34,0.10)' }}>
              <label className="block text-sm font-medium mb-2" style={{ color: '#8B6F4E' }}>
                Name your album
              </label>
              <input
                type="text"
                placeholder="e.g. Summer in Tuscany · 2031"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createAlbum()}
                className="w-full rounded-xl px-4 py-3 mb-3 focus:outline-none transition text-base"
                style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                maxLength={60}
              />
              {error && <p className="text-sm mb-3" style={{ color: '#C0392B' }}>{error}</p>}
              <button
                onClick={createAlbum}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50"
                style={{ background: '#254F22', color: '#FDFAF5' }}
              >
                {loading ? 'Creating your album...' : <>Create Album <ArrowRight className="w-4 h-4" /></>}
              </button>
              <p className="text-xs mt-3 text-center" style={{ color: '#B0A090' }}>
                You'll receive a private link to manage your album
              </p>
            </div>
          </div>

          {/* Right — floating photo cards over the nature image */}
          <div className="relative hidden lg:flex items-center justify-center" style={{ height: '520px' }}>

            {/* Card 1 — top left */}
            <div className="absolute rounded-2xl overflow-hidden shadow-2xl" style={{ top: '30px', left: '10px', width: '200px', height: '250px', transform: 'rotate(-4deg)', border: '4px solid rgba(255,255,255,0.9)' }}>
              <img src="/card1.jpg" alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-end p-3" style={{ background: 'linear-gradient(to top, rgba(37,79,34,0.6) 0%, transparent 55%)' }}>
                <span className="text-xs font-medium" style={{ color: '#FDFAF5', fontFamily: 'var(--font-serif)' }}>Morning hike</span>
              </div>
            </div>

            {/* Card 2 — top right */}
            <div className="absolute rounded-2xl overflow-hidden shadow-2xl" style={{ top: '10px', right: '30px', width: '180px', height: '220px', transform: 'rotate(3deg)', border: '4px solid rgba(255,255,255,0.9)' }}>
              <img src="/card2.jpg" alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-end p-3" style={{ background: 'linear-gradient(to top, rgba(124,74,45,0.6) 0%, transparent 55%)' }}>
                <span className="text-xs font-medium" style={{ color: '#FDFAF5', fontFamily: 'var(--font-serif)' }}>Golden hour</span>
              </div>
            </div>

            {/* Card 3 — center, largest */}
            <div className="absolute rounded-2xl overflow-hidden shadow-2xl" style={{ top: '160px', left: '70px', width: '240px', height: '270px', transform: 'rotate(1deg)', border: '4px solid rgba(255,255,255,0.95)', zIndex: 10 }}>
              <img src="/card3.jpg" alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-end p-3" style={{ background: 'linear-gradient(to top, rgba(27,58,107,0.6) 0%, transparent 55%)' }}>
                <span className="text-xs font-medium" style={{ color: '#FDFAF5', fontFamily: 'var(--font-serif)' }}>Lake at dusk</span>
              </div>
            </div>

            {/* Card 4 — bottom right */}
            <div className="absolute rounded-2xl overflow-hidden shadow-2xl" style={{ bottom: '30px', right: '20px', width: '190px', height: '190px', transform: 'rotate(-2deg)', border: '4px solid rgba(255,255,255,0.9)' }}>
              <img src="/children.avif" alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-end p-3" style={{ background: 'linear-gradient(to top, rgba(139,111,78,0.6) 0%, transparent 55%)' }}>
                <span className="text-xs font-medium" style={{ color: '#FDFAF5', fontFamily: 'var(--font-serif)' }}>Little explorers</span>
              </div>
            </div>

            {/* Floating "live" badge */}
            <div className="absolute rounded-2xl px-4 py-3 shadow-xl" style={{ top: '270px', right: '15px', background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(221,213,197,0.8)', zIndex: 20, backdropFilter: 'blur(8px)' }}>
              <p className="text-xs font-semibold" style={{ color: '#254F22' }}>✦ 12 photos added</p>
              <p className="text-xs" style={{ color: '#8B6F4E' }}>by 5 people</p>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="max-w-6xl mx-auto px-8 py-12">
        <div className="flex items-center gap-6">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p className="text-sm italic" style={{ color: '#B0A090', fontFamily: 'var(--font-serif)', whiteSpace: 'nowrap' }}>how it works</p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>
      </div>

      {/* Steps — polaroid filmstrip */}
      <section className="max-w-5xl mx-auto px-6 pb-24 pt-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-14 md:gap-6 items-start">
          {[
            {
              rot: -3.5,
              lift: 0,
              bg: '#F2E9D8',
              tapeColor: 'rgba(196, 152, 96, 0.45)',
              captionColor: '#7C4A2D',
              caption: '"Name it."',
              label: 'First',
              desc: 'Give your album a name. You get a private link you own — no account, no app.',
              illo: (
                <svg viewBox="0 0 100 100" className="w-20 h-20" fill="none" stroke="#7C4A2D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 78 L52 44 L62 54 L28 88 L14 92 Z" fill="#FBF4E4" />
                  <path d="M52 44 L66 30 A6 6 0 0 1 76 40 L62 54" fill="#E8D5B0" />
                  <path d="M14 92 L18 78" />
                  <path d="M30 62 L50 42" opacity="0.35" />
                </svg>
              ),
            },
            {
              rot: 2.5,
              lift: 32,
              bg: '#E6EEE3',
              tapeColor: 'rgba(120, 150, 110, 0.4)',
              captionColor: '#254F22',
              caption: '"Share it."',
              label: 'Then',
              desc: 'Text it, print a QR for the table, drop it in the group chat. One link, everyone in.',
              illo: (
                <svg viewBox="0 0 100 100" className="w-20 h-20" fill="none" stroke="#254F22">
                  <rect x="18" y="18" width="26" height="26" rx="2" strokeWidth="2.5" />
                  <rect x="24" y="24" width="6" height="6" fill="#254F22" />
                  <rect x="32" y="24" width="6" height="6" fill="#254F22" />
                  <rect x="24" y="32" width="6" height="6" fill="#254F22" />
                  <rect x="56" y="18" width="26" height="26" rx="2" strokeWidth="2.5" />
                  <rect x="62" y="24" width="6" height="6" fill="#254F22" />
                  <rect x="70" y="24" width="6" height="6" fill="#254F22" />
                  <rect x="70" y="32" width="6" height="6" fill="#254F22" />
                  <rect x="18" y="56" width="26" height="26" rx="2" strokeWidth="2.5" />
                  <rect x="24" y="62" width="6" height="6" fill="#254F22" />
                  <rect x="24" y="70" width="6" height="6" fill="#254F22" />
                  <rect x="32" y="70" width="6" height="6" fill="#254F22" />
                  <rect x="56" y="56" width="4" height="4" fill="#254F22" />
                  <rect x="64" y="56" width="4" height="4" fill="#254F22" />
                  <rect x="72" y="56" width="4" height="4" fill="#254F22" />
                  <rect x="56" y="64" width="4" height="4" fill="#254F22" />
                  <rect x="64" y="72" width="4" height="4" fill="#254F22" />
                  <rect x="72" y="64" width="4" height="4" fill="#254F22" />
                  <rect x="72" y="72" width="4" height="4" fill="#254F22" />
                </svg>
              ),
            },
            {
              rot: -1.5,
              lift: 12,
              bg: '#DCE4EE',
              tapeColor: 'rgba(120, 135, 170, 0.4)',
              captionColor: '#1B3A6B',
              caption: '"Keep it."',
              label: 'As long as you want',
              desc: 'Photos flow in from everyone who came. Free albums stay put — untouched for a year, they quietly retire. Active ones live on.',
              illo: (
                <svg viewBox="0 0 100 100" className="w-20 h-20" fill="none">
                  <rect x="14" y="28" width="48" height="48" rx="3" fill="#FBF4E4" stroke="#1B3A6B" strokeWidth="2" transform="rotate(-8 38 52)" />
                  <rect x="28" y="22" width="48" height="48" rx="3" fill="#EAE2D0" stroke="#1B3A6B" strokeWidth="2" transform="rotate(4 52 46)" />
                  <rect x="24" y="20" width="48" height="48" rx="3" fill="#FFFFFF" stroke="#1B3A6B" strokeWidth="2" />
                  <circle cx="38" cy="36" r="4" fill="#1B3A6B" />
                  <path d="M24 60 L36 48 L48 56 L60 44 L72 56 L72 68 L24 68 Z" fill="#254F22" opacity="0.85" />
                </svg>
              ),
            },
          ].map((step, i) => (
            <div key={i} className="flex flex-col items-center" style={{ marginTop: step.lift }}>
              {/* Polaroid */}
              <div
                className="relative bg-white"
                style={{
                  width: '240px',
                  padding: '14px 14px 56px 14px',
                  transform: `rotate(${step.rot}deg)`,
                  boxShadow: '0 18px 44px rgba(37,79,34,0.16), 0 2px 8px rgba(37,79,34,0.08)',
                }}
              >
                {/* Masking tape at top */}
                <div
                  className="absolute -top-3 left-1/2"
                  style={{
                    width: '64px',
                    height: '22px',
                    background: step.tapeColor,
                    transform: 'translateX(-50%) rotate(-3deg)',
                    borderRadius: '1px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                  }}
                />

                {/* Photo area */}
                <div
                  className="flex items-center justify-center aspect-square"
                  style={{ background: step.bg }}
                >
                  {step.illo}
                </div>

                {/* Handwritten caption in the white margin */}
                <div className="absolute bottom-3 left-0 right-0 text-center">
                  <span
                    style={{
                      fontFamily: 'var(--font-serif)',
                      fontStyle: 'italic',
                      color: step.captionColor,
                      fontSize: '1.15rem',
                    }}
                  >
                    {step.caption}
                  </span>
                </div>
              </div>

              {/* Description under the polaroid — counter-rotated so copy stays level */}
              <div
                className="mt-8 text-center px-2"
                style={{ maxWidth: '240px', transform: `rotate(${-step.rot * 0.3}deg)` }}
              >
                <p
                  className="text-xs uppercase mb-2"
                  style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}
                >
                  {step.label}
                </p>
                <p className="text-sm leading-relaxed" style={{ color: '#6B5A4E' }}>
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ divider */}
      <div className="max-w-6xl mx-auto px-8 pt-10 pb-12">
        <div className="flex items-center gap-6">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p
            style={{
              color: '#254F22',
              fontFamily: 'var(--font-serif)',
              fontSize: '1.75rem',
              fontWeight: 700,
              letterSpacing: '0.25em',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            FAQ
          </p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>
      </div>

      {/* FAQ — journal-page style */}
      <section className="max-w-3xl mx-auto px-6 pb-24">
        <div
          className="rounded-[8px] px-6 py-4 md:px-10 md:py-6"
          style={{
            background: '#FBF4E4',
            border: '1px solid rgba(196,166,120,0.35)',
            boxShadow: '0 10px 36px rgba(37,79,34,0.08)',
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent 0, transparent 47px, rgba(196,166,120,0.15) 47px, rgba(196,166,120,0.15) 48px)',
          }}
        >
          {[
            {
              q: 'Do guests need an account to add photos?',
              a: 'No. Anyone with your album link can view and add photos — no sign-up, no app, no download. Hushare is designed so the only friction between a guest and the album is tapping the link.',
            },
            {
              q: 'How long does Hushare keep my photos?',
              a: 'Free albums are preserved as long as they remain active. If an album sits untouched by everyone for 12 months, it is automatically retired and its media is deleted. Active albums live on indefinitely. Paid tiers will remove this inactivity rule.',
            },
            {
              q: 'Is Hushare really free?',
              a: 'Yes — free during beta, with no credit card. When we introduce paid tiers, free albums will remain free; paid tiers will add larger storage caps, HD video, and removal of the 12-month inactivity rule.',
            },
            {
              q: 'Can I use a QR code at a wedding or event?',
              a: 'Yes. Every album has a unique link you can turn into a QR code and print on table cards, invitations, programs, or a welcome sign. Guests scan it and start adding photos instantly.',
            },
            {
              q: 'Can I download all the photos at once?',
              a: 'Yes. From the owner view of your album, you can download the full collection as a single ZIP file — originals, not compressed thumbnails.',
            },
            {
              q: 'Who can see my album?',
              a: 'Only people with the link. Albums are unlisted — they are not indexed by search engines and cannot be discovered by browsing the site. Share the link only with the people you want to invite.',
            },
            {
              q: 'What happens if I lose my owner link?',
              a: 'The owner link is how Hushare recognises you as the album creator. Bookmark it as soon as you create an album, or forward it to yourself. If you do lose it, contact us with your album name and approximate creation date and we will verify you manually.',
            },
            {
              q: 'What photo formats and sizes are supported?',
              a: 'JPG, PNG, HEIC, and WebP images up to 25 MB each. Short video clips (MP4, MOV) are planned for a future release. There is no cap on the number of photos per free album during beta.',
            },
          ].map(({ q, a }, i, arr) => (
            <details
              key={i}
              className="group"
              style={{
                borderBottom: i === arr.length - 1 ? 'none' : '1px dashed rgba(196,166,120,0.45)',
              }}
            >
              <summary
                className="list-none cursor-pointer flex items-start gap-4 py-5 select-none"
                style={{ outline: 'none' }}
              >
                <span
                  aria-hidden
                  className="flex-none inline-flex items-center justify-center rounded-full transition-transform group-open:rotate-45"
                  style={{
                    width: '28px',
                    height: '28px',
                    background: '#254F22',
                    color: '#FDFAF5',
                    fontSize: '18px',
                    lineHeight: 1,
                    marginTop: '2px',
                  }}
                >
                  +
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-serif)',
                    color: '#254F22',
                    fontSize: '1.15rem',
                    fontWeight: 600,
                    lineHeight: 1.35,
                  }}
                >
                  {q}
                </span>
              </summary>
              <p
                className="pb-6 pl-12 pr-2 text-[0.95rem] leading-relaxed"
                style={{ color: '#5C4A3C' }}
              >
                {a}
              </p>
            </details>
          ))}
        </div>

        {/* Footer note under FAQ */}
        <p
          className="text-center text-sm mt-8 italic"
          style={{ color: '#8B6F4E', fontFamily: 'var(--font-serif)' }}
        >
          Still curious? Write to us at{' '}
          <a href="mailto:hello@hushare.org" style={{ color: '#254F22', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
            hello@hushare.org
          </a>
        </p>
      </section>

      {/* Bottom CTA — photo postcard */}
      <section className="mx-4 md:mx-8 mb-20 relative">
        <div
          className="relative rounded-[28px] overflow-hidden"
          style={{
            minHeight: '440px',
            backgroundImage: 'url(/wedding.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            boxShadow: '0 24px 60px rgba(37,79,34,0.22)',
          }}
        >
          {/* Warm painterly overlay */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(115deg, rgba(30,45,25,0.72) 0%, rgba(55,40,30,0.55) 45%, rgba(80,50,30,0.15) 100%)',
            }}
          />

          {/* Grain texture using radial dots */}
          <div
            className="absolute inset-0 opacity-[0.12] mix-blend-overlay pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(rgba(255,240,200,0.6) 1px, transparent 1px)',
              backgroundSize: '3px 3px',
            }}
          />

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-0 min-h-[440px]">
            {/* Left — floating paper card */}
            <div className="md:col-span-7 flex items-center px-6 sm:px-10 md:px-14 py-14">
              <div
                className="relative max-w-lg p-8 md:p-10"
                style={{
                  background: 'rgba(253, 248, 237, 0.96)',
                  backdropFilter: 'blur(6px)',
                  border: '1px solid rgba(196, 166, 120, 0.35)',
                  boxShadow: '0 14px 40px rgba(20,30,15,0.35)',
                  transform: 'rotate(-1.2deg)',
                  borderRadius: '4px',
                }}
              >
                {/* Corner stamp */}
                <div
                  className="absolute -top-3 -right-3 w-16 h-20 flex flex-col items-center justify-center"
                  style={{
                    background: '#F3E0BC',
                    border: '1.5px dashed #8B6F4E',
                    transform: 'rotate(6deg)',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
                  }}
                >
                  <Leaf className="w-5 h-5" style={{ color: '#254F22' }} />
                  <span
                    className="text-[9px] mt-1 tracking-widest uppercase"
                    style={{ color: '#7C4A2D', fontWeight: 700 }}
                  >
                    Hushare
                  </span>
                </div>

                {/* Postmark circle */}
                <div
                  className="absolute -top-6 right-16 w-20 h-20 rounded-full hidden md:flex items-center justify-center opacity-60"
                  style={{
                    border: '1.5px solid #7C4A2D',
                    transform: 'rotate(-8deg)',
                  }}
                >
                  <span
                    className="text-[10px] tracking-[0.2em] uppercase"
                    style={{ color: '#7C4A2D', fontFamily: 'var(--font-serif)' }}
                  >
                    Kept · 2026
                  </span>
                </div>

                {/* "To:" line */}
                <p
                  className="text-[11px] uppercase mb-3"
                  style={{ color: '#8B6F4E', letterSpacing: '0.22em', fontWeight: 600 }}
                >
                  To — the keeper of moments
                </p>

                <h2
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontStyle: 'italic',
                    color: '#254F22',
                    fontSize: 'clamp(1.9rem, 3.4vw, 2.5rem)',
                    lineHeight: 1.15,
                    fontWeight: 700,
                  }}
                >
                  Start your first<br />shared album.
                </h2>

                <div
                  className="my-5 h-px w-16"
                  style={{ background: '#C4A678' }}
                />

                <p
                  className="text-sm leading-relaxed"
                  style={{ color: '#5C4A3C', maxWidth: '24rem' }}
                >
                  Free while we're in beta. One link, any number of guests, no
                  app to install. Albums stay until they sit untouched for a year.
                </p>

                <button
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="mt-7 inline-flex items-center gap-2 font-semibold transition hover:opacity-90"
                  style={{
                    background: '#254F22',
                    color: '#FDFAF5',
                    padding: '14px 28px',
                    borderRadius: '999px',
                    boxShadow: '0 6px 18px rgba(37,79,34,0.35)',
                  }}
                >
                  Create your album <ArrowRight className="w-4 h-4" />
                </button>

                {/* Signature mark */}
                <p
                  className="mt-6 text-sm italic"
                  style={{
                    color: '#7C4A2D',
                    fontFamily: 'var(--font-serif)',
                  }}
                >
                  — with love, from Yerevan
                </p>
              </div>
            </div>

            {/* Right — intentionally empty so photo breathes on desktop */}
            <div className="md:col-span-5" />
          </div>
        </div>
      </section>

      <footer className="px-8 py-6 flex items-center justify-between text-sm" style={{ borderTop: '1px solid #E8E0D0' }}>
        <div className="flex items-center gap-2">
          <Leaf className="w-4 h-4" style={{ color: '#254F22' }} />
          <span style={{ fontFamily: 'var(--font-serif)', color: '#254F22', fontWeight: 600 }}>Husher</span>
        </div>
        <span style={{ color: '#B0A090' }}>© {new Date().getFullYear()} — your moments, always.</span>
      </footer>
    </main>
  )
}