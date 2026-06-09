'use client'

import { useEffect, useState } from 'react'

export default function HamburgerMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {/* Desktop nav links — hidden below 768px via CSS */}
      <div className="hush-nav-links hush-hamburger-desktop">
        {children}
      </div>

      {/* Mobile hamburger button — elastic animation (jonsuh/hamburgers) */}
      <button
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        className={`hush-hamburger hamburger hamburger--elastic${open ? ' is-active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="hamburger-box">
          <span className="hamburger-inner" />
        </span>
      </button>

      {/* Full-screen blurred overlay — mobile only */}
      <div
        className={`hush-mobile-overlay${open ? ' hush-mobile-overlay--open' : ''}`}
        aria-hidden={!open}
        onClick={() => setOpen(false)}
      >
        <nav className="hush-mobile-nav" onClick={e => e.stopPropagation()}>
          {children}
        </nav>
      </div>
    </>
  )
}
