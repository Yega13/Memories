'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function HamburgerMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen]       = useState(false)
  const [mounted, setMounted] = useState(false)
  const scrollYRef            = useRef(0)

  useEffect(() => { setMounted(true) }, [])

  // iOS-safe scroll lock: position:fixed + restore exact scroll position on close
  useEffect(() => {
    if (open) {
      scrollYRef.current = window.scrollY
      const s = document.body.style
      s.position = 'fixed'
      s.top      = `-${scrollYRef.current}px`
      s.left     = '0'
      s.right    = '0'
    } else {
      const s = document.body.style
      s.position = ''
      s.top      = ''
      s.left     = ''
      s.right    = ''
      window.scrollTo(0, scrollYRef.current)
    }
    return () => {
      const s = document.body.style
      s.position = s.top = s.left = s.right = ''
    }
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Rendered via portal into document.body so it escapes the nav's
  // backdrop-filter stacking context (which breaks position:fixed children)
  const overlay = (
    <div
      className={`hush-mobile-overlay${open ? ' hush-mobile-overlay--open' : ''}`}
      aria-hidden={!open}
      onClick={() => setOpen(false)}
    >
      <nav className="hush-mobile-nav" onClick={e => e.stopPropagation()}>
        {children}
      </nav>
    </div>
  )

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

      {mounted && createPortal(overlay, document.body)}
    </>
  )
}
