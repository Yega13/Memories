'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

export interface GlobeMarker {
  lat: number
  lng: number
  label: string
  src?: string  // unused — we render dots
}

interface GlobeConfig {
  atmosphereColor?: string
  atmosphereIntensity?: number
  bumpScale?: number
  autoRotateSpeed?: number
}

interface Props {
  markers?: GlobeMarker[]
  config?: GlobeConfig
  onMarkerClick?: (marker: GlobeMarker) => void
  onMarkerHover?: (marker: GlobeMarker | null) => void
}

// Atmosphere glow via Fresnel-like shader applied to the back face of a slightly larger sphere
const VERT_ATM = /* glsl */`
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAG_ATM = /* glsl */`
  varying vec3 vNormal;
  uniform vec3 uColor;
  uniform float uIntensity;
  void main() {
    float d = dot(vNormal, vec3(0.0, 0.0, 1.0));
    float power = pow(max(0.0, 0.72 - d), max(1.0, uIntensity * 0.09));
    gl_FragColor = vec4(uColor, power);
  }
`

// lat/lng degrees → position on a sphere of radius r
// Matches standard Three.js spherical convention
function toPos(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi   = (90 - lat) * Math.PI / 180
  const theta = (lng + 180) * Math.PI / 180
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  )
}

// Earth textures from the three-globe package CDN
const CDN = 'https://unpkg.com/three-globe/example/img'

export function Globe3D({
  markers = [],
  config = {},
  onMarkerClick,
  onMarkerHover,
}: Props) {
  const mountRef  = useRef<HTMLDivElement>(null)
  // Store Three.js state in a ref so pointer handlers always see current values
  const threeRef  = useRef({
    renderer:     null as THREE.WebGLRenderer | null,
    camera:       null as THREE.PerspectiveCamera | null,
    earth:        null as THREE.Mesh | null,
    markerMeshes: [] as THREE.Mesh[],
    raycaster:    new THREE.Raycaster(),
    mouse:        new THREE.Vector2(),
    rafId:        null as number | null,
    isDragging:   false,
    prevMouse:    { x: 0, y: 0 },
    rotY:         0,
    tiltX:        0.25,
  })
  const [tooltip, setTooltip] = useState<{ label: string; x: number; y: number } | null>(null)

  const {
    atmosphereColor  = '#4da6ff',
    atmosphereIntensity = 20,
    bumpScale        = 5,
    autoRotateSpeed  = 0.3,
  } = config

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const t = threeRef.current

    const w = mount.clientWidth  || 480
    const h = mount.clientHeight || 480

    // ── Renderer ────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    mount.appendChild(renderer.domElement)
    t.renderer = renderer

    // ── Scene + Camera ───────────────────────────────────────────────────────
    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
    camera.position.z = 2.6
    t.camera = camera

    // ── Lighting ────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(5, 3, 5)
    scene.add(sun)

    // ── Earth ────────────────────────────────────────────────────────────────
    const loader   = new THREE.TextureLoader()
    const earthGeo = new THREE.SphereGeometry(1, 64, 64)
    const earthMat = new THREE.MeshPhongMaterial({
      map:         loader.load(`${CDN}/earth-blue-marble.jpg`),
      bumpMap:     loader.load(`${CDN}/earth-topology.png`),
      bumpScale:   bumpScale * 0.0015,
      specularMap: loader.load(`${CDN}/earth-water.png`),
      specular:    new THREE.Color(0x111111),
      shininess:   20,
    })
    const earth = new THREE.Mesh(earthGeo, earthMat)
    earth.rotation.x = t.tiltX
    earth.rotation.y = t.rotY
    scene.add(earth)
    t.earth = earth

    // ── Atmosphere ───────────────────────────────────────────────────────────
    const atmC   = new THREE.Color(atmosphereColor)
    const atmGeo = new THREE.SphereGeometry(1.1, 48, 48)
    const atmMat = new THREE.ShaderMaterial({
      vertexShader:   VERT_ATM,
      fragmentShader: FRAG_ATM,
      uniforms: {
        uColor:     { value: new THREE.Vector3(atmC.r, atmC.g, atmC.b) },
        uIntensity: { value: atmosphereIntensity },
      },
      blending:    THREE.AdditiveBlending,
      side:        THREE.BackSide,
      transparent: true,
      depthWrite:  false,
    })
    scene.add(new THREE.Mesh(atmGeo, atmMat))

    // ── Markers (children of earth so they rotate with it) ──────────────────
    const markerMeshes: THREE.Mesh[] = []
    for (const m of markers) {
      const pos = toPos(m.lat, m.lng, 1.022)
      const geo = new THREE.SphereGeometry(0.026, 16, 16)
      const mat = new THREE.MeshBasicMaterial({ color: 0xff1111 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(pos)
      mesh.userData.marker = m
      earth.add(mesh)
      markerMeshes.push(mesh)
    }
    t.markerMeshes = markerMeshes

    // ── Animation loop ───────────────────────────────────────────────────────
    function animate() {
      t.rafId = requestAnimationFrame(animate)
      if (!t.isDragging) {
        t.rotY += autoRotateSpeed * 0.003
        earth.rotation.y = t.rotY
      }
      renderer.render(scene, camera)
    }
    animate()

    // ── Resize ───────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const nw = mount.clientWidth
      const nh = mount.clientHeight
      if (!nw || !nh) return
      renderer.setSize(nw, nh)
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    return () => {
      ro.disconnect()
      if (t.rafId) cancelAnimationFrame(t.rafId)
      renderer.dispose()
      earthGeo.dispose()
      earthMat.dispose()
      atmGeo.dispose()
      atmMat.dispose()
      for (const m of markerMeshes) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // intentionally static — config props don't change at runtime

  // ── Pointer events ─────────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const t = threeRef.current
    e.currentTarget.setPointerCapture(e.pointerId)
    t.isDragging = true
    t.prevMouse  = { x: e.clientX, y: e.clientY }
    e.currentTarget.style.cursor = 'grabbing'
    setTooltip(null)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const t = threeRef.current
    const mount = mountRef.current
    if (!mount || !t.camera || !t.earth) return

    if (t.isDragging) {
      const dx = e.clientX - t.prevMouse.x
      const dy = e.clientY - t.prevMouse.y
      t.rotY  += dx * 0.005
      t.tiltX  = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, t.tiltX + dy * 0.005))
      t.earth.rotation.y = t.rotY
      t.earth.rotation.x = t.tiltX
      t.prevMouse = { x: e.clientX, y: e.clientY }
      setTooltip(null)
      return
    }

    // Raycast for hover
    const rect = mount.getBoundingClientRect()
    t.mouse.x  =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    t.mouse.y  = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    t.raycaster.setFromCamera(t.mouse, t.camera)
    const hits = t.raycaster.intersectObjects(t.markerMeshes)
    if (hits.length > 0) {
      const marker = hits[0].object.userData.marker as GlobeMarker
      setTooltip({ label: marker.label, x: e.clientX - rect.left, y: e.clientY - rect.top })
      onMarkerHover?.(marker)
    } else {
      setTooltip(null)
      onMarkerHover?.(null)
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    threeRef.current.isDragging = false
    e.currentTarget.style.cursor = 'grab'
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const t = threeRef.current
    const mount = mountRef.current
    if (!mount || !t.camera) return
    const rect = mount.getBoundingClientRect()
    t.mouse.x  =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    t.mouse.y  = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    t.raycaster.setFromCamera(t.mouse, t.camera)
    const hits = t.raycaster.intersectObjects(t.markerMeshes)
    if (hits.length > 0) {
      onMarkerClick?.(hits[0].object.userData.marker as GlobeMarker)
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
      <div
        ref={mountRef}
        style={{ width: '100%', height: '100%', cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setTooltip(null)}
        onClick={onClick}
      />
      {tooltip && (
        <div
          style={{
            position:    'absolute',
            left:        tooltip.x + 14,
            top:         tooltip.y - 34,
            background:  'rgba(255,255,255,0.96)',
            border:      '1px solid rgba(221,213,197,0.8)',
            borderRadius:'8px',
            padding:     '4px 12px',
            fontSize:    '12px',
            fontWeight:  600,
            color:       '#1B2E1A',
            pointerEvents:'none',
            whiteSpace:  'nowrap',
            boxShadow:   '0 4px 14px rgba(0,0,0,0.18)',
            zIndex:      10,
          }}
        >
          {tooltip.label}
        </div>
      )}
    </div>
  )
}
