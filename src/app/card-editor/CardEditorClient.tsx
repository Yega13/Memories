'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Stage, Layer, Text, Line, Image as KonvaImage, Rect, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Download, ImagePlus, RotateCcw, Trash2, Type } from 'lucide-react'
import QRCode from 'qrcode'

// ─── Dimensions ───────────────────────────────────────────────────────────────

const STAGE_W = 480
const STAGE_H = Math.round(STAGE_W * 1700 / 1200) // 680
const DL_RATIO = 1200 / STAGE_W                   // ≈ 2.5 → 1200×1700 export

// ─── Element types ────────────────────────────────────────────────────────────

type TextEl = {
  id: string; kind: 'text'
  x: number; y: number; rotation: number
  text: string; fontSize: number; fontFamily: string
  fontStyle: string; fill: string
  align: 'left' | 'center' | 'right'; width: number
}
type LineEl = {
  id: string; kind: 'line'
  x: number; y: number; rotation: number
  length: number; stroke: string; strokeWidth: number
}
type ImgEl = {
  id: string; kind: 'image'
  x: number; y: number; rotation: number
  src: string; w: number; h: number
}
type El = TextEl | LineEl | ImgEl

function uid() { return Math.random().toString(36).slice(2) }

function defaultElements(title: string, qrDataUrl: string): El[] {
  const cx = STAGE_W / 2
  return [
    {
      id: 'heading', kind: 'text',
      x: cx, y: 72, rotation: 0,
      text: title || 'CAPTURE THE MOMENT',
      fontSize: 32, fontFamily: "'Playfair Display', Georgia, serif",
      fontStyle: 'bold', fill: '#111111', align: 'center', width: 400,
    },
    {
      id: 'sep', kind: 'line',
      x: cx - 70, y: 152, rotation: 0,
      length: 140, stroke: '#254F22', strokeWidth: 2,
    },
    {
      id: 'body', kind: 'text',
      x: cx, y: 168, rotation: 0,
      text: 'Scan the QR code with your camera to upload your photos and videos.',
      fontSize: 14, fontFamily: "'Playfair Display', Georgia, serif",
      fontStyle: 'normal', fill: '#555555', align: 'center', width: 320,
    },
    {
      id: 'qr', kind: 'image',
      x: cx - 90, y: 255, rotation: 0,
      src: qrDataUrl, w: 180, h: 180,
    },
    {
      id: 'footer', kind: 'text',
      x: cx, y: STAGE_H - 38, rotation: 0,
      text: 'hushare.space',
      fontSize: 11, fontFamily: "'Playfair Display', Georgia, serif",
      fontStyle: 'italic', fill: '#AAAAAA', align: 'center', width: 180,
    },
  ]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useLoadedImage(src: string | null): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement>()
  useEffect(() => {
    if (!src) { setImg(undefined); return }
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = src
  }, [src])
  return img
}

// A thin wrapper so each ImgEl can use a hook (rules of hooks: only at top level)
// We pre-load all image srcs into a Map via a single effect instead.

// ─── Sidebar sub-components ───────────────────────────────────────────────────

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
          className="w-20 rounded border px-1.5 py-0.5 text-xs font-mono" style={{ borderColor: '#E0E0E0' }} />
        <input type="color" value={value} onChange={e => { setHex(e.target.value); onChange(e.target.value) }}
          className="rounded cursor-pointer" style={{ width: 28, height: 24, border: '1px solid #E0E0E0', padding: 2 }} />
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-xs font-mono text-gray-400">{Math.round(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} className="w-full" />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CardEditorClient() {
  const params = useSearchParams()
  const shareUrl = params.get('url') ?? ''
  const initialTitle = params.get('title') ?? ''

  const [bgColor, setBgColor] = useState('#FFFFFF')
  const [elements, setElements] = useState<El[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [loadedImgs, setLoadedImgs] = useState<Record<string, HTMLImageElement>>({})
  const [downloading, setDownloading] = useState(false)
  const [fontsReady, setFontsReady] = useState(false)

  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const shapeRefs = useRef<Record<string, Konva.Node>>({})
  const logoInputRef = useRef<HTMLInputElement>(null)

  // Load fonts
  useEffect(() => {
    document.fonts.ready.then(() => {
      Promise.all([
        document.fonts.load("bold 32px 'Playfair Display'"),
        document.fonts.load("italic 16px 'Playfair Display'"),
        document.fonts.load("400 16px 'Playfair Display'"),
      ]).finally(() => setFontsReady(true))
    })
  }, [])

  // Generate QR and init elements
  useEffect(() => {
    if (!shareUrl) return
    QRCode.toDataURL(shareUrl, { width: 400, margin: 1, color: { dark: '#111111', light: '#FFFFFF' } })
      .then(url => {
        setQrDataUrl(url)
        setElements(defaultElements(initialTitle, url))
      })
  }, [shareUrl, initialTitle])

  // Load images referenced by elements
  useEffect(() => {
    const srcs = elements.filter((e): e is ImgEl => e.kind === 'image').map(e => e.src)
    const missing = srcs.filter(s => !loadedImgs[s])
    if (missing.length === 0) return
    missing.forEach(src => {
      const img = new Image()
      img.onload = () => setLoadedImgs(prev => ({ ...prev, [src]: img }))
      img.src = src
    })
  }, [elements, loadedImgs])

  // Sync transformer to selected node
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    const node = selectedId ? shapeRefs.current[selectedId] : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedId, elements])

  // Delete key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
        selectedId &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)) {
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setElements(prev => prev.filter(e => e.id !== selectedId))
    setSelectedId(null)
  }, [selectedId])

  function updateEl<T extends El>(id: string, patch: Partial<T>) {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  function handleDragEnd(id: string, e: KonvaEventObject<DragEvent>) {
    updateEl(id, { x: e.target.x(), y: e.target.y() })
  }

  function handleTransformEnd(id: string, e: KonvaEventObject<Event>) {
    const node = e.target
    const el = elements.find(e => e.id === id)
    if (!el) return
    const sx = node.scaleX(), sy = node.scaleY()
    if (el.kind === 'text') {
      updateEl<TextEl>(id, {
        x: node.x(), y: node.y(), rotation: node.rotation(),
        fontSize: Math.max(6, Math.round(el.fontSize * sy)),
        width: Math.max(40, Math.round(el.width * sx)),
      })
    } else if (el.kind === 'line') {
      updateEl<LineEl>(id, {
        x: node.x(), y: node.y(), rotation: node.rotation(),
        length: Math.max(10, Math.round(el.length * sx)),
        strokeWidth: Math.max(0.5, el.strokeWidth * sy),
      })
    } else if (el.kind === 'image') {
      updateEl<ImgEl>(id, {
        x: node.x(), y: node.y(), rotation: node.rotation(),
        w: Math.max(20, Math.round(el.w * sx)),
        h: Math.max(20, Math.round(el.h * sy)),
      })
    }
    node.scaleX(1); node.scaleY(1)
  }

  function addText() {
    const el: TextEl = {
      id: uid(), kind: 'text',
      x: STAGE_W / 2, y: 80, rotation: 0,
      text: 'New text', fontSize: 20,
      fontFamily: "'Playfair Display', Georgia, serif",
      fontStyle: 'normal', fill: '#111111', align: 'center', width: 300,
    }
    setElements(prev => [...prev, el])
    setSelectedId(el.id)
  }

  function addLine() {
    const el: LineEl = {
      id: uid(), kind: 'line',
      x: STAGE_W / 2 - 80, y: 200, rotation: 0,
      length: 160, stroke: '#254F22', strokeWidth: 2,
    }
    setElements(prev => [...prev, el])
    setSelectedId(el.id)
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result as string
      const el: ImgEl = {
        id: uid(), kind: 'image',
        x: STAGE_W / 2 - 80, y: 100, rotation: 0,
        src, w: 160, h: 160,
      }
      setElements(prev => [...prev, el])
      setSelectedId(el.id)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function replaceQR(newQrDataUrl: string) {
    setElements(prev => prev.map(e =>
      e.kind === 'image' && e.id === selectedId
        ? { ...e, src: newQrDataUrl }
        : e
    ))
  }

  async function handleDownload() {
    if (!stageRef.current) return
    setSelectedId(null)
    setDownloading(true)
    // Wait a frame so transformer hides
    await new Promise(r => setTimeout(r, 60))
    try {
      const dataUrl = stageRef.current.toDataURL({ pixelRatio: DL_RATIO, mimeType: 'image/png' })
      const link = document.createElement('a')
      link.download = `${(initialTitle || 'card').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-table-card.png`
      link.href = dataUrl
      link.click()
    } finally {
      setDownloading(false)
    }
  }

  function resetLayout() {
    if (qrDataUrl) setElements(defaultElements(initialTitle, qrDataUrl))
    setSelectedId(null)
  }

  const selected = elements.find(e => e.id === selectedId)

  // ─── Sidebar panel for selected element ──────────────────────────────────────

  function renderSelectedProps() {
    if (!selected) return null
    return (
      <div className="space-y-3 pt-3 border-t" style={{ borderColor: '#F0F0F0' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: '#254F22' }}>
            {selected.kind === 'text' ? 'Text' : selected.kind === 'line' ? 'Line' : 'Image'} selected
          </span>
          <button onClick={deleteSelected} className="flex items-center gap-1 text-xs rounded-lg px-2 py-1 transition hover:opacity-80"
            style={{ background: '#FFF0F0', color: '#C0392B', border: '1px solid #FFCCCC' }}>
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>

        {selected.kind === 'text' && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Text</label>
              <textarea
                value={selected.text}
                onChange={e => updateEl<TextEl>(selected.id, { text: e.target.value })}
                className="w-full rounded-lg border px-2 py-1.5 text-sm"
                style={{ borderColor: '#E0E0E0', resize: 'vertical', minHeight: 60 }}
              />
            </div>
            <Slider label="Font size" value={selected.fontSize} min={8} max={80} onChange={v => updateEl<TextEl>(selected.id, { fontSize: v })} />
            <Slider label="Width" value={selected.width} min={60} max={STAGE_W - 20} onChange={v => updateEl<TextEl>(selected.id, { width: v })} />
            <div>
              <label className="text-xs text-gray-500 block mb-1">Font</label>
              <select value={selected.fontFamily}
                onChange={e => updateEl<TextEl>(selected.id, { fontFamily: e.target.value })}
                className="w-full rounded border px-2 py-1 text-xs" style={{ borderColor: '#E0E0E0' }}>
                <option value="'Playfair Display', Georgia, serif">Playfair Display (Serif)</option>
                <option value="'Geist', system-ui, sans-serif">Geist (Sans)</option>
                <option value="'Playwrite GB J', cursive">Playwrite (Script)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Style</label>
              <div className="flex gap-1">
                {(['normal', 'bold', 'italic', 'bold italic'] as const).map(s => (
                  <button key={s} onClick={() => updateEl<TextEl>(selected.id, { fontStyle: s })}
                    className="flex-1 text-xs rounded py-1 transition"
                    style={{
                      background: selected.fontStyle === s ? '#254F22' : '#F5F0E8',
                      color: selected.fontStyle === s ? '#FDFAF5' : '#5C3D2E',
                      border: '1px solid ' + (selected.fontStyle === s ? '#254F22' : '#DDD5C5'),
                      fontWeight: s.includes('bold') ? 700 : 400,
                      fontStyle: s.includes('italic') ? 'italic' : 'normal',
                    }}>
                    {s === 'normal' ? 'Aa' : s === 'bold' ? 'B' : s === 'italic' ? 'I' : 'BI'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Align</label>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map(a => (
                  <button key={a} onClick={() => updateEl<TextEl>(selected.id, { align: a })}
                    className="flex-1 text-xs rounded py-1 transition"
                    style={{
                      background: selected.align === a ? '#254F22' : '#F5F0E8',
                      color: selected.align === a ? '#FDFAF5' : '#5C3D2E',
                      border: '1px solid ' + (selected.align === a ? '#254F22' : '#DDD5C5'),
                    }}>
                    {a === 'left' ? '⬤·' : a === 'center' ? '·⬤·' : '·⬤'}
                  </button>
                ))}
              </div>
            </div>
            <ColorInput label="Color" value={selected.fill} onChange={v => updateEl<TextEl>(selected.id, { fill: v })} />
          </>
        )}

        {selected.kind === 'line' && (
          <>
            <Slider label="Length" value={selected.length} min={20} max={STAGE_W - 40} onChange={v => updateEl<LineEl>(selected.id, { length: v })} />
            <Slider label="Thickness" value={selected.strokeWidth} min={0.5} max={12} step={0.5} onChange={v => updateEl<LineEl>(selected.id, { strokeWidth: v })} />
            <ColorInput label="Color" value={selected.stroke} onChange={v => updateEl<LineEl>(selected.id, { stroke: v })} />
          </>
        )}

        {selected.kind === 'image' && (
          <>
            <Slider label="Width" value={selected.w} min={40} max={STAGE_W - 20} onChange={v => updateEl<ImgEl>(selected.id, { w: v, h: Math.round(v * selected.h / selected.w) })} />
            <label className="flex items-center justify-center gap-2 w-full rounded-xl py-2 text-xs font-semibold cursor-pointer transition hover:opacity-80"
              style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px dashed #DDD5C5' }}>
              <ImagePlus className="w-3 h-3" /> Replace image
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
          </>
        )}
      </div>
    )
  }

  // ─── Canvas render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#EBEBEB', fontFamily: 'system-ui, sans-serif' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 sticky top-0 z-10"
        style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E5E5' }}>
        <button onClick={() => window.close()} className="text-sm font-medium" style={{ color: '#555' }}>← Close</button>
        <span className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>Card Editor</span>
        <div className="flex gap-2">
          <button onClick={resetLayout} title="Reset to default"
            className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-2 transition hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
          <button onClick={handleDownload} disabled={downloading || !shareUrl}
            className="flex items-center gap-1.5 text-sm font-semibold rounded-xl px-4 py-2 transition hover:opacity-90 disabled:opacity-40"
            style={{ background: '#254F22', color: '#FDFAF5' }}>
            <Download className="w-4 h-4" />
            {downloading ? 'Generating…' : 'Download PNG'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-0 flex-1">
        {/* Sidebar */}
        <div className="lg:w-72 shrink-0 overflow-y-auto p-4 space-y-4"
          style={{ background: '#FFFFFF', borderRight: '1px solid #E5E5E5', maxHeight: 'calc(100vh - 57px)' }}>

          {/* Background */}
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: '#555' }}>Background</p>
            <ColorInput label="Color" value={bgColor} onChange={setBgColor} />
          </div>

          <div className="border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: '#555' }}>Add element</p>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={addText}
                className="flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-2 transition hover:opacity-80"
                style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
                <Type className="w-3 h-3" /> Text
              </button>
              <button onClick={addLine}
                className="flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-2 transition hover:opacity-80"
                style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
                ─ Line
              </button>
              <label className="flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-2 transition hover:opacity-80 cursor-pointer"
                style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
                <ImagePlus className="w-3 h-3" /> Image
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
            </div>
          </div>

          {/* Selected element props */}
          {renderSelectedProps()}

          {!selected && (
            <div className="pt-2">
              <p className="text-xs" style={{ color: '#AAAAAA' }}>
                Click any element on the canvas to select it. Drag to move, use handles to resize or rotate.
              </p>
            </div>
          )}

          <div className="pt-2 border-t" style={{ borderColor: '#F0F0F0' }}>
            <p className="text-xs" style={{ color: '#AAAAAA' }}>
              1200×1700 px download — A5 / 5×7&quot; print-ready
            </p>
          </div>
        </div>

        {/* Canvas area */}
        <div className="flex-1 flex items-start justify-center p-6 overflow-auto">
          <div style={{ position: 'relative' }}>
            {!fontsReady && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.7)', fontSize: 13, color: '#888' }}>
                Loading fonts…
              </div>
            )}
            <Stage
              ref={stageRef}
              width={STAGE_W}
              height={STAGE_H}
              style={{ borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.18)', cursor: 'default' }}
              onMouseDown={e => { if (e.target === e.target.getStage()) setSelectedId(null) }}
            >
              <Layer>
                {/* Background */}
                <Rect x={0} y={0} width={STAGE_W} height={STAGE_H} fill={bgColor} />

                {/* Elements */}
                {elements.map(el => {
                  const isSelected = el.id === selectedId
                  const commonProps = {
                    draggable: true,
                    onClick: () => setSelectedId(el.id),
                    onTap: () => setSelectedId(el.id),
                    onDragEnd: (e: KonvaEventObject<DragEvent>) => handleDragEnd(el.id, e),
                    onTransformEnd: (e: KonvaEventObject<Event>) => handleTransformEnd(el.id, e),
                    ref: (node: Konva.Node | null) => {
                      if (node) shapeRefs.current[el.id] = node
                      else delete shapeRefs.current[el.id]
                    },
                  }

                  if (el.kind === 'text') {
                    return (
                      <Text
                        key={el.id}
                        {...commonProps}
                        x={el.x}
                        y={el.y}
                        offsetX={el.align === 'center' ? el.width / 2 : 0}
                        rotation={el.rotation}
                        text={el.text}
                        fontSize={el.fontSize}
                        fontFamily={el.fontFamily}
                        fontStyle={el.fontStyle}
                        fill={el.fill}
                        align={el.align}
                        width={el.width}
                        lineHeight={1.35}
                        wrap="word"
                      />
                    )
                  }

                  if (el.kind === 'line') {
                    return (
                      <Line
                        key={el.id}
                        {...commonProps}
                        x={el.x}
                        y={el.y}
                        rotation={el.rotation}
                        points={[0, 0, el.length, 0]}
                        stroke={el.stroke}
                        strokeWidth={el.strokeWidth}
                        hitStrokeWidth={12}
                      />
                    )
                  }

                  if (el.kind === 'image') {
                    const img = loadedImgs[el.src]
                    if (!img) return null
                    return (
                      <KonvaImage
                        key={el.id}
                        {...commonProps}
                        x={el.x}
                        y={el.y}
                        rotation={el.rotation}
                        image={img}
                        width={el.w}
                        height={el.h}
                      />
                    )
                  }

                  return null
                })}

                <Transformer
                  ref={transformerRef}
                  rotateEnabled={true}
                  boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
                  anchorSize={9}
                  anchorCornerRadius={3}
                  borderStroke="#254F22"
                  anchorStroke="#254F22"
                  anchorFill="#FFFFFF"
                  rotateAnchorOffset={20}
                />
              </Layer>
            </Stage>
          </div>
        </div>
      </div>
    </div>
  )
}
