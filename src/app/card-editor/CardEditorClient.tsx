'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Stage, Layer, Text, Line, Image as KonvaImage, Rect, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Download, ImagePlus, RotateCcw, Trash2, Type } from 'lucide-react'
import QRCode from 'qrcode'

// ─── Constants ────────────────────────────────────────────────────────────────

const LOGICAL_W = 480   // stage coordinate space (never changes)
const LOGICAL_H = Math.round(LOGICAL_W * 1700 / 1200) // 680
const SNAP_DIST = 10

// ─── Types ────────────────────────────────────────────────────────────────────

type TextEl = { id: string; kind: 'text'; x: number; y: number; rotation: number; text: string; fontSize: number; fontFamily: string; fontStyle: string; fill: string; align: 'left' | 'center' | 'right'; width: number }
type LineEl = { id: string; kind: 'line'; x: number; y: number; rotation: number; length: number; stroke: string; strokeWidth: number }
type ImgEl  = { id: string; kind: 'image'; x: number; y: number; rotation: number; src: string; w: number; h: number }
type El = TextEl | LineEl | ImgEl

function uid() { return Math.random().toString(36).slice(2) }

const CX = LOGICAL_W / 2

function defaultElements(title: string, qrDataUrl: string): El[] {
  return [
    { id: 'heading', kind: 'text', x: CX - 200, y: 72, rotation: 0, text: title || 'CAPTURE THE MOMENT', fontSize: 32, fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'bold', fill: '#111111', align: 'center', width: 400 },
    { id: 'sep', kind: 'line', x: CX - 70, y: 152, rotation: 0, length: 140, stroke: '#254F22', strokeWidth: 2 },
    { id: 'body', kind: 'text', x: CX - 160, y: 168, rotation: 0, text: 'Scan the QR code with your camera to upload your photos and videos.', fontSize: 14, fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'normal', fill: '#555555', align: 'center', width: 320 },
    { id: 'qr', kind: 'image', x: CX - 90, y: 255, rotation: 0, src: qrDataUrl, w: 180, h: 180 },
    { id: 'footer', kind: 'text', x: CX - 90, y: LOGICAL_H - 38, rotation: 0, text: 'hushare.space', fontSize: 11, fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'italic', fill: '#AAAAAA', align: 'center', width: 180 },
  ]
}

function getHalfSize(el: El) {
  if (el.kind === 'text')  return { hw: el.width / 2, hh: el.fontSize }
  if (el.kind === 'line')  return { hw: el.length / 2, hh: el.strokeWidth / 2 }
  return { hw: el.w / 2, hh: el.h / 2 }
}

// ─── Tiny UI helpers ──────────────────────────────────────────────────────────

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [hex, setHex] = useState(value)
  useEffect(() => setHex(value), [value])
  function handle(raw: string) {
    const v = raw.startsWith('#') ? raw : '#' + raw
    setHex(v)
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v)
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        <input type="text" value={hex} onChange={e => handle(e.target.value)} maxLength={7}
          className="rounded border px-1.5 py-0.5 text-xs font-mono" style={{ width: 72, borderColor: '#E0E0E0' }} />
        <input type="color" value={value} onChange={e => { setHex(e.target.value); onChange(e.target.value) }}
          className="rounded cursor-pointer" style={{ width: 28, height: 24, border: '1px solid #E0E0E0', padding: 2 }} />
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-xs font-mono text-gray-400">{Math.round(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full" style={{ height: 20 }} />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CardEditorClient() {
  const params  = useSearchParams()
  const router  = useRouter()
  const shareUrl    = params.get('url') ?? ''
  const initialTitle = params.get('title') ?? ''

  // Stage physical size (scales to fit screen)
  const [stageW, setStageW] = useState(LOGICAL_W)
  const stageH   = Math.round(stageW * 1700 / 1200)
  const stageScale = stageW / LOGICAL_W
  const dlRatio  = 1200 / stageW

  useEffect(() => {
    function update() { setStageW(Math.min(LOGICAL_W, window.innerWidth - 16)) }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const [bgColor, setBgColor] = useState('#FFFFFF')
  const [elements, setElements]   = useState<El[]>([])
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [transformingId, setTransformingId] = useState<string | null>(null)
  const [guides, setGuides] = useState({ h: false, v: false })
  const [loadedImgs, setLoadedImgs] = useState<Record<string, HTMLImageElement>>({})
  const [downloading, setDownloading] = useState(false)
  const [fontsReady, setFontsReady] = useState(false)

  // Two-finger touch state
  const touchRef = useRef<{ lastAngle: number | null }>({ lastAngle: null })

  const stageRef      = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const shapeRefs     = useRef<Record<string, Konva.Node>>({})
  const stageContainer = useRef<HTMLDivElement>(null)

  // Prevent default two-finger scroll/zoom on canvas
  useEffect(() => {
    const el = stageContainer.current
    if (!el) return
    function onTouch(e: TouchEvent) { if (e.touches.length >= 2) e.preventDefault() }
    el.addEventListener('touchmove', onTouch, { passive: false })
    return () => el.removeEventListener('touchmove', onTouch)
  }, [])

  // Font loading
  useEffect(() => {
    document.fonts.ready.then(() => {
      Promise.all([
        document.fonts.load("bold 32px 'Playfair Display'"),
        document.fonts.load("italic 16px 'Playfair Display'"),
        document.fonts.load("400 16px 'Playfair Display'"),
      ]).finally(() => setFontsReady(true))
    })
  }, [])

  // QR + initial elements
  useEffect(() => {
    if (!shareUrl) return
    QRCode.toDataURL(shareUrl, { width: 400, margin: 1, color: { dark: '#111111', light: '#FFFFFF' } })
      .then(url => setElements(defaultElements(initialTitle, url)))
  }, [shareUrl, initialTitle])

  // Load images
  useEffect(() => {
    elements.filter((e): e is ImgEl => e.kind === 'image')
      .filter(e => !loadedImgs[e.src])
      .forEach(e => {
        const img = new Image()
        img.onload = () => setLoadedImgs(p => ({ ...p, [e.src]: img }))
        img.src = e.src
      })
  }, [elements, loadedImgs])

  // Transformer sync
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    const nodeId = transformingId ?? selectedId
    const node = nodeId ? shapeRefs.current[nodeId] : null
    tr.nodes(node ? [node] : [])
    if (node) {
      if (transformingId) {
        tr.enabledAnchors(['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'])
        tr.rotateEnabled(true)
      } else {
        tr.enabledAnchors([])
        tr.rotateEnabled(false)
      }
    }
    tr.getLayer()?.batchDraw()
  }, [selectedId, transformingId, elements])

  // Delete key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId &&
        !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        deleteSelected()
      }
      if (e.key === 'Escape') { setSelectedId(null); setTransformingId(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setElements(p => p.filter(e => e.id !== selectedId))
    setSelectedId(null); setTransformingId(null)
  }, [selectedId])

  function updateEl<T extends El>(id: string, patch: Partial<Omit<T, 'id' | 'kind'>>) {
    setElements(p => p.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  // Two-finger rotation
  function handleStageTouchStart(e: KonvaEventObject<TouchEvent>) {
    if (e.evt.touches.length === 2) {
      const t1 = e.evt.touches[0], t2 = e.evt.touches[1]
      touchRef.current.lastAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI
    }
  }

  function handleStageTouchMove(e: KonvaEventObject<TouchEvent>) {
    if (e.evt.touches.length !== 2 || !selectedId) return
    const t1 = e.evt.touches[0], t2 = e.evt.touches[1]
    const angle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI
    if (touchRef.current.lastAngle !== null) {
      let delta = angle - touchRef.current.lastAngle
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360
      const node = shapeRefs.current[selectedId]
      if (node) { node.rotation(node.rotation() + delta); node.getLayer()?.batchDraw() }
    }
    touchRef.current.lastAngle = angle
  }

  function handleStageTouchEnd() {
    if (selectedId && touchRef.current.lastAngle !== null) {
      const node = shapeRefs.current[selectedId]
      if (node) updateEl(selectedId, { rotation: node.rotation() })
    }
    touchRef.current.lastAngle = null
  }

  function handleDragMove(id: string, e: KonvaEventObject<DragEvent>) {
    const node = e.target
    const el = elements.find(e => e.id === id)
    if (!el) return
    const { hw, hh } = getHalfSize(el)
    const nearV = Math.abs(node.x() + hw - CX) < SNAP_DIST
    const nearH = Math.abs(node.y() + hh - LOGICAL_H / 2) < SNAP_DIST
    if (nearV) node.x(CX - hw)
    if (nearH) node.y(LOGICAL_H / 2 - hh)
    setGuides({ v: nearV, h: nearH })
  }

  function handleDragEnd(id: string, e: KonvaEventObject<DragEvent>) {
    setGuides({ h: false, v: false })
    updateEl(id, { x: e.target.x(), y: e.target.y() })
  }

  function handleTransformEnd(id: string, e: KonvaEventObject<Event>) {
    const node = e.target
    const el = elements.find(e => e.id === id)
    if (!el) return
    const sx = node.scaleX(), sy = node.scaleY()
    if (el.kind === 'text')  updateEl<TextEl>(id, { x: node.x(), y: node.y(), rotation: node.rotation(), fontSize: Math.max(6, Math.round(el.fontSize * sy)), width: Math.max(40, Math.round(el.width * sx)) })
    if (el.kind === 'line')  updateEl<LineEl>(id, { x: node.x(), y: node.y(), rotation: node.rotation(), length: Math.max(10, Math.round(el.length * sx)), strokeWidth: Math.max(0.5, el.strokeWidth * sy) })
    if (el.kind === 'image') updateEl<ImgEl>(id,  { x: node.x(), y: node.y(), rotation: node.rotation(), w: Math.max(20, Math.round(el.w * sx)), h: Math.max(20, Math.round(el.h * sy)) })
    node.scaleX(1); node.scaleY(1)
  }

  function addText() {
    const el: TextEl = { id: uid(), kind: 'text', x: CX - 150, y: 80, rotation: 0, text: 'New text', fontSize: 20, fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'normal', fill: '#111111', align: 'center', width: 300 }
    setElements(p => [...p, el]); setSelectedId(el.id); setTransformingId(null)
  }

  function addLine() {
    const el: LineEl = { id: uid(), kind: 'line', x: CX - 80, y: 200, rotation: 0, length: 160, stroke: '#254F22', strokeWidth: 2 }
    setElements(p => [...p, el]); setSelectedId(el.id); setTransformingId(null)
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result as string
      const el: ImgEl = { id: uid(), kind: 'image', x: CX - 80, y: 100, rotation: 0, src, w: 160, h: 160 }
      setElements(p => [...p, el]); setSelectedId(el.id); setTransformingId(null)
    }
    reader.readAsDataURL(file); e.target.value = ''
  }

  async function handleDownload() {
    if (!stageRef.current) return
    setSelectedId(null); setTransformingId(null); setDownloading(true)
    await new Promise(r => setTimeout(r, 80))
    try {
      const dataUrl = stageRef.current.toDataURL({ pixelRatio: dlRatio, mimeType: 'image/png' })
      const link = document.createElement('a')
      link.download = `${(initialTitle || 'card').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-table-card.png`
      link.href = dataUrl; link.click()
    } finally { setDownloading(false) }
  }

  function resetLayout() {
    QRCode.toDataURL(shareUrl, { width: 400, margin: 1, color: { dark: '#111111', light: '#FFFFFF' } })
      .then(url => { setElements(defaultElements(initialTitle, url)); setBgColor('#FFFFFF') })
    setSelectedId(null); setTransformingId(null)
  }

  const selected = elements.find(e => e.id === selectedId)

  // ─── Controls panel ───────────────────────────────────────────────────────────

  function renderControls() {
    return (
      <div className="space-y-3">
        {/* Background */}
        <ColorInput label="Background" value={bgColor} onChange={setBgColor} />

        {/* Add element */}
        <div>
          <p className="text-xs font-semibold mb-1.5" style={{ color: '#555' }}>Add</p>
          <div className="flex gap-1.5">
            <button onClick={addText} className="flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-2 transition hover:opacity-80"
              style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
              <Type className="w-3 h-3" /> Text
            </button>
            <button onClick={addLine} className="flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-2 transition hover:opacity-80"
              style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
              ─ Line
            </button>
            <label className="flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-2 cursor-pointer transition hover:opacity-80"
              style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
              <ImagePlus className="w-3 h-3" /> Image
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
          </div>
        </div>

        {/* Selected element */}
        {selected && (
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: '#F0F0F0' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: '#254F22' }}>
                {selected.kind === 'text' ? 'Text' : selected.kind === 'line' ? 'Line' : 'Image'}
              </span>
              <div className="flex gap-1.5">
                {transformingId
                  ? <button onClick={() => setTransformingId(null)} className="text-xs rounded-lg px-2 py-1" style={{ background: '#E8F5E9', color: '#254F22', border: '1px solid #C8E6C9' }}>Lock</button>
                  : <button onClick={() => setTransformingId(selectedId)} className="text-xs rounded-lg px-2 py-1" style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>Resize</button>
                }
                <button onClick={deleteSelected} className="flex items-center gap-1 text-xs rounded-lg px-2 py-1" style={{ background: '#FFF0F0', color: '#C0392B', border: '1px solid #FFCCCC' }}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            {selected.kind === 'text' && (
              <>
                <textarea value={selected.text} onChange={e => updateEl<TextEl>(selected.id, { text: e.target.value })}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: '#E0E0E0', resize: 'vertical', minHeight: 52 }} />
                <Slider label="Size" value={selected.fontSize} min={8} max={80} onChange={v => updateEl<TextEl>(selected.id, { fontSize: v })} />
                <Slider label="Width" value={selected.width} min={60} max={LOGICAL_W - 20} onChange={v => updateEl<TextEl>(selected.id, { width: v })} />
                <div className="flex gap-1">
                  <select value={selected.fontFamily} onChange={e => updateEl<TextEl>(selected.id, { fontFamily: e.target.value })}
                    className="flex-1 rounded border px-1.5 py-1 text-xs" style={{ borderColor: '#E0E0E0' }}>
                    <option value="'Playfair Display', Georgia, serif">Playfair (Serif)</option>
                    <option value="'Geist', system-ui, sans-serif">Sans</option>
                    <option value="'Playwrite GB J', cursive">Script</option>
                  </select>
                  {(['normal','bold','italic'] as const).map(s => (
                    <button key={s} onClick={() => updateEl<TextEl>(selected.id, { fontStyle: s })}
                      className="text-xs rounded px-2 py-1" style={{ background: selected.fontStyle === s ? '#254F22' : '#F5F0E8', color: selected.fontStyle === s ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (selected.fontStyle === s ? '#254F22' : '#DDD5C5'), fontWeight: s === 'bold' ? 700 : 400, fontStyle: s === 'italic' ? 'italic' : 'normal' }}>
                      {s === 'normal' ? 'Aa' : s === 'bold' ? 'B' : 'I'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {(['left','center','right'] as const).map(a => (
                    <button key={a} onClick={() => updateEl<TextEl>(selected.id, { align: a })}
                      className="flex-1 text-xs rounded py-1" style={{ background: selected.align === a ? '#254F22' : '#F5F0E8', color: selected.align === a ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (selected.align === a ? '#254F22' : '#DDD5C5') }}>
                      {a === 'left' ? 'L' : a === 'center' ? 'C' : 'R'}
                    </button>
                  ))}
                </div>
                <ColorInput label="Color" value={selected.fill} onChange={v => updateEl<TextEl>(selected.id, { fill: v })} />
              </>
            )}
            {selected.kind === 'line' && (
              <>
                <Slider label="Length" value={selected.length} min={20} max={LOGICAL_W - 40} onChange={v => updateEl<LineEl>(selected.id, { length: v })} />
                <Slider label="Thickness" value={selected.strokeWidth} min={0.5} max={12} step={0.5} onChange={v => updateEl<LineEl>(selected.id, { strokeWidth: v })} />
                <ColorInput label="Color" value={selected.stroke} onChange={v => updateEl<LineEl>(selected.id, { stroke: v })} />
              </>
            )}
            {selected.kind === 'image' && (
              <>
                <Slider label="Width" value={selected.w} min={40} max={LOGICAL_W - 20} onChange={v => updateEl<ImgEl>(selected.id, { w: v, h: Math.round(v * selected.h / selected.w) })} />
                <label className="flex items-center justify-center gap-2 w-full rounded-xl py-2 text-xs font-semibold cursor-pointer hover:opacity-80"
                  style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px dashed #DDD5C5' }}>
                  <ImagePlus className="w-3 h-3" /> Replace image
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
              </>
            )}
          </div>
        )}

        {!selected && <p className="text-xs" style={{ color: '#AAAAAA' }}>Tap an element to edit. Two fingers to rotate.</p>}
      </div>
    )
  }

  // ─── Shared Konva element props ───────────────────────────────────────────────

  function elProps(el: El) {
    return {
      draggable: true,
      onClick:   () => { setSelectedId(el.id); setTransformingId(null) },
      onTap:     () => { setSelectedId(el.id); setTransformingId(null) },
      onDblClick: () => { setSelectedId(el.id); setTransformingId(el.id) },
      onDblTap:   () => { setSelectedId(el.id); setTransformingId(el.id) },
      onDragMove: (e: KonvaEventObject<DragEvent>) => handleDragMove(el.id, e),
      onDragEnd:  (e: KonvaEventObject<DragEvent>) => handleDragEnd(el.id, e),
      onTransformEnd: (e: KonvaEventObject<Event>) => handleTransformEnd(el.id, e),
      ref: (node: Konva.Node | null) => {
        if (node) shapeRefs.current[el.id] = node
        else delete shapeRefs.current[el.id]
      },
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F0F0F0', fontFamily: 'system-ui, sans-serif' }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 sticky top-0 z-20"
        style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E5E5', minHeight: 48 }}>
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium" style={{ color: '#555' }}>
          ← <span className="hidden sm:inline">Back</span>
        </button>
        <span className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>Card Editor</span>
        <div className="flex gap-1.5">
          <button onClick={resetLayout} title="Reset" className="flex items-center gap-1 text-xs font-medium rounded-lg px-2 py-1.5 transition hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
            <RotateCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Reset</span>
          </button>
          <button onClick={handleDownload} disabled={downloading || !shareUrl}
            className="flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 transition hover:opacity-90 disabled:opacity-40"
            style={{ background: '#254F22', color: '#FDFAF5' }}>
            <Download className="w-3.5 h-3.5" />
            {downloading ? '…' : <><span className="hidden sm:inline">Download</span> PNG</>}
          </button>
        </div>
      </div>

      {/* Body: canvas on top (mobile), sidebar on left (desktop) */}
      <div className="flex flex-col lg:flex-row flex-1">

        {/* Canvas — order-1 on mobile, order-2 on desktop */}
        <div className="order-1 lg:order-2 flex-1 flex items-start justify-center p-3 overflow-auto">
          <div ref={stageContainer} style={{ position: 'relative' }}>
            {!fontsReady && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.8)', fontSize: 12, color: '#888' }}>
                Loading…
              </div>
            )}
            <Stage
              ref={stageRef}
              width={stageW}
              height={stageH}
              scaleX={stageScale}
              scaleY={stageScale}
              style={{ borderRadius: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', display: 'block' }}
              onMouseDown={e => { if (e.target === e.target.getStage()) { setSelectedId(null); setTransformingId(null) } }}
              onTouchStart={handleStageTouchStart}
              onTouchMove={handleStageTouchMove}
              onTouchEnd={handleStageTouchEnd}
            >
              <Layer>
                <Rect x={0} y={0} width={LOGICAL_W} height={LOGICAL_H} fill={bgColor} />

                {elements.map(el => {
                  const p = elProps(el)
                  if (el.kind === 'text')  return <Text key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} text={el.text} fontSize={el.fontSize} fontFamily={el.fontFamily} fontStyle={el.fontStyle} fill={el.fill} align={el.align} width={el.width} lineHeight={1.35} wrap="word" />
                  if (el.kind === 'line')  return <Line key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} points={[0, 0, el.length, 0]} stroke={el.stroke} strokeWidth={el.strokeWidth} hitStrokeWidth={14} />
                  if (el.kind === 'image') {
                    const img = loadedImgs[el.src]
                    if (!img) return null
                    return <KonvaImage key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} image={img} width={el.w} height={el.h} />
                  }
                  return null
                })}

                {guides.v && <Line points={[CX, 0, CX, LOGICAL_H]} stroke="#3B82F6" strokeWidth={1} dash={[6, 4]} listening={false} />}
                {guides.h && <Line points={[0, LOGICAL_H / 2, LOGICAL_W, LOGICAL_H / 2]} stroke="#3B82F6" strokeWidth={1} dash={[6, 4]} listening={false} />}

                <Transformer
                  ref={transformerRef}
                  rotateEnabled={!!transformingId}
                  boundBoxFunc={(old, next) => (next.width < 10 || next.height < 10 ? old : next)}
                  anchorSize={8}
                  anchorCornerRadius={3}
                  borderStroke="#254F22"
                  anchorStroke="#254F22"
                  anchorFill="#FFFFFF"
                  rotateAnchorOffset={18}
                />
              </Layer>
            </Stage>
          </div>
        </div>

        {/* Controls — order-2 on mobile (below canvas), order-1 on desktop (left sidebar) */}
        <div
          className="order-2 lg:order-1 lg:w-64 shrink-0 p-3 overflow-y-auto max-h-[52vh] lg:max-h-[calc(100vh-48px)]"
          style={{ background: '#FFFFFF', borderTop: '1px solid #E5E5E5' }}
        >
          {renderControls()}
        </div>

      </div>
    </div>
  )
}
