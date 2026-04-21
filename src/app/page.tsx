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

      {/* ── HERO ── full-bleed, image takes right half with diagonal cut */}
      <div className="relative min-h-screen overflow-hidden">

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

        {/* Nav */}
        <nav className="relative z-10 flex items-center justify-between px-8 py-5" style={{ borderBottom: '1px solid rgba(232,224,208,0.6)' }}>
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

        {/* Hero content grid */}
        <div className="relative z-10 max-w-6xl mx-auto px-8 pt-16 pb-24 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center min-h-[calc(100vh-73px)]">

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
              <img src="/card4.jpg" alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-end p-3" style={{ background: 'linear-gradient(to top, rgba(139,111,78,0.6) 0%, transparent 55%)' }}>
                <span className="text-xs font-medium" style={{ color: '#FDFAF5', fontFamily: 'var(--font-serif)' }}>Wild flowers</span>
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
              label: 'Forever',
              desc: 'Photos flow in from everyone who came. The album is yours — it never expires.',
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

      {/* Bottom CTA */}
      <section className="mx-8 mb-16 rounded-3xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #254F22 0%, #1B3A6B 100%)' }}>
        <div className="px-12 py-14 flex flex-col md:flex-row items-center justify-between gap-8">
          <div>
            <h2 style={{ fontFamily: 'var(--font-serif)', color: '#FDFAF5', fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Ready to preserve a moment?
            </h2>
            <p style={{ color: '#B8D9B2' }}>Free forever for small albums. No credit card required.</p>
          </div>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-2 font-semibold rounded-2xl px-8 py-4 transition hover:opacity-90 whitespace-nowrap"
            style={{ background: '#FDFAF5', color: '#254F22' }}
          >
            Start for free <ArrowRight className="w-4 h-4" />
          </button>
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