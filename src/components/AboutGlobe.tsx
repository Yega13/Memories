'use client'

import createGlobe from 'cobe'
import { useEffect, useRef } from 'react'

const MARKERS = [
  { location: [40.1792, 44.4991] as [number, number], size: 0.12 },   // Armenia (Yerevan)
  { location: [37.0902, -95.7129] as [number, number], size: 0.1 },   // USA
  { location: [56.1304, -106.3468] as [number, number], size: 0.09 }, // Canada
  { location: [44.4268, 26.1025] as [number, number], size: 0.08 },   // Romania
  { location: [49.8153, 6.1296] as [number, number], size: 0.07 },    // Luxembourg
  { location: [55.7558, 37.6173] as [number, number], size: 0.09 },   // Russia (Moscow)
]

const GLOBE_PX = 500

export default function AboutGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phiRef = useRef(0.4)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const globe = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: GLOBE_PX * 2,
      height: GLOBE_PX * 2,
      phi: phiRef.current,
      theta: 0.25,
      dark: 1,
      diffuse: 1.4,
      mapSamples: 16000,
      mapBrightness: 5,
      baseColor: [0.13, 0.22, 0.12],
      markerColor: [0.77, 0.65, 0.47],
      glowColor: [0.14, 0.28, 0.12],
      markers: MARKERS,
    })

    let rafId: number
    function tick() {
      phiRef.current += 0.003
      globe.update({ phi: phiRef.current })
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      globe.destroy()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', aspectRatio: '1 / 1', display: 'block' }}
    />
  )
}
