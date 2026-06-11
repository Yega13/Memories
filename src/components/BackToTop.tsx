'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

// How far from the bottom (px) to start nudging the button up above the footer
const FOOTER_HEIGHT = 147

export default function BackToTop() {
  const [visible, setVisible] = useState(false)
  const [bottom, setBottom]   = useState(24)

  useEffect(() => {
    function update() {
      const scrollY      = window.scrollY
      const docHeight    = document.documentElement.scrollHeight
      const winHeight    = window.innerHeight
      // Clamp to 0 — iOS rubber-band overscroll makes scrollY exceed the page
      // height, producing a negative value that inflates targetBottom.
      const distFromBottom = Math.max(0, docHeight - scrollY - winHeight)

      setVisible(scrollY > 280)

      // Smoothly push the button up as the footer enters the viewport
      const targetBottom = Math.max(24, FOOTER_HEIGHT - distFromBottom + 24)
      setBottom(targetBottom)
    }

    window.addEventListener('scroll', update, { passive: true })
    update()
    return () => window.removeEventListener('scroll', update)
  }, [])

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      style={{
        position:      'fixed',
        right:         '1.25rem',
        bottom:        `${bottom}px`,
        zIndex:        80,
        width:         '42px',
        height:        '42px',
        borderRadius:  '50%',
        background:    '#254F22',
        color:         '#FDFAF5',
        border:        'none',
        cursor:        'pointer',
        display:       'flex',
        alignItems:    'center',
        justifyContent:'center',
        boxShadow:     '0 4px 16px rgba(37,79,34,0.28)',
        opacity:        visible ? 1 : 0,
        pointerEvents:  visible ? 'auto' : 'none',
        transition:    'opacity 0.22s ease, bottom 0.18s ease',
      }}
    >
      <ArrowUp size={18} strokeWidth={2.5} />
    </button>
  )
}
