'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Stage, Layer, Text, Line, Rect as KRect, Ellipse, Image as KonvaImage, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  AlignCenter, AlignLeft, AlignRight, ArrowLeft, ChevronDown, ChevronUp, Circle,
  Copy, Download, Eye, EyeOff, ImagePlus, Layers, Lock, Minus, MousePointer,
  Plus, Redo2, RotateCcw, Square, Trash2, Type, Undo2, Unlock, Minus as LineIcon,
} from 'lucide-react'
import QRCode from 'qrcode'

// ─── Dimensions ───────────────────────────────────────────────────────────────

const LW = 480        // logical card width (coordinate space)
const LH = Math.round(LW * 1700 / 1200)  // 680

// ─── Types ────────────────────────────────────────────────────────────────────

type Base = { id: string; x: number; y: number; rotation: number; opacity: number; locked: boolean; visible: boolean; name: string; shadowEnabled?: boolean; shadowColor?: string; shadowBlur?: number; shadowOffsetX?: number; shadowOffsetY?: number }
type TextEl    = Base & { kind: 'text';    text: string; fontSize: number; fontFamily: string; fontStyle: string; textDecoration: string; fill: string; align: 'left'|'center'|'right'; width: number; letterSpacing: number; lineHeight: number }
type RectEl    = Base & { kind: 'rect';    width: number; height: number; fill: string; stroke: string; strokeWidth: number; cornerRadius: number }
type EllipseEl = Base & { kind: 'ellipse'; radiusX: number; radiusY: number; fill: string; stroke: string; strokeWidth: number }
type LineEl    = Base & { kind: 'line';    length: number; stroke: string; strokeWidth: number; lineCap: 'butt'|'round'; dashed: boolean }
type ImgEl     = Base & { kind: 'image';   src: string; width: number; height: number }
type El = TextEl | RectEl | EllipseEl | LineEl | ImgEl

type HistState = { els: El[]; bg: string }

function uid() { return Math.random().toString(36).slice(2, 9) }
function base(name: string): Base { return { id: uid(), x: LW/2, y: LH/2, rotation: 0, opacity: 1, locked: false, visible: true, name } }

const CX = LW / 2, CY = LH / 2
const SNAP = 8

// ─── Templates ────────────────────────────────────────────────────────────────

function makeQrEl(src: string): ImgEl {
  return { ...base('QR Code'), kind: 'image', x: CX - 85, y: 300, src, width: 170, height: 170 }
}

function template(title: string, qr: string, style: 'branded'|'bw'|'clean'): { els: El[]; bg: string } {
  const SERIF = "'Playfair Display', Georgia, serif"
  const footer: TextEl = { ...base('Footer'), kind: 'text', x: CX - 90, y: LH - 36, text: 'hushare.space', fontSize: 11, fontFamily: SERIF, fontStyle: 'italic', textDecoration: '', fill: '#AAAAAA', align: 'center', width: 180, letterSpacing: 0.5, lineHeight: 1.2 }
  const qrEl = makeQrEl(qr)

  if (style === 'branded') {
    // Red header band — matches the actual Hushare branded design (z-order: first = bottom)
    const headerRect: RectEl = { ...base('Header'), locked: true, kind: 'rect', x: 0, y: 0, width: LW, height: 100, fill: '#630826', stroke: '#630826', strokeWidth: 0, cornerRadius: 0 }
    const shadowRect: RectEl = { ...base('Header shadow'), locked: true, kind: 'rect', x: 0, y: 100, width: LW, height: 4, fill: '#9B1727', stroke: '#9B1727', strokeWidth: 0, cornerRadius: 0 }
    // Logo: 618×146 native → scale to fit 228×54 in header (locked, not editable by accident)
    const logoImg: ImgEl = { ...base('Logo'), locked: true, kind: 'image', x: (LW - 228) / 2, y: 23, src: '/logo/logo-light-transparent.png', width: 228, height: 54 }
    const heading: TextEl = { ...base('Heading'), kind: 'text', x: CX - 200, y: 120, text: title || 'CAPTURE THE MOMENT', fontSize: 28, fontFamily: SERIF, fontStyle: 'bold', textDecoration: '', fill: '#1A1A1A', align: 'center', width: 400, letterSpacing: 1, lineHeight: 1.3 }
    const sep: LineEl = { ...base('Divider'), kind: 'line', x: CX - 70, y: 200, length: 140, stroke: '#630826', strokeWidth: 2, lineCap: 'round', dashed: false }
    const body: TextEl = { ...base('Body'), kind: 'text', x: CX - 155, y: 215, text: 'Scan the QR code with your camera to upload your photos and videos.', fontSize: 13, fontFamily: SERIF, fontStyle: 'normal', textDecoration: '', fill: '#555555', align: 'center', width: 310, letterSpacing: 0, lineHeight: 1.5 }
    return { els: [headerRect, shadowRect, logoImg, footer, qrEl, body, sep, heading], bg: '#FAFAFA' }
  }

  if (style === 'clean') {
    const heading: TextEl = { ...base('Heading'), kind: 'text', x: CX - 200, y: 72, text: title || 'CAPTURE THE MOMENT', fontSize: 30, fontFamily: SERIF, fontStyle: 'bold', textDecoration: '', fill: '#111111', align: 'center', width: 400, letterSpacing: 1, lineHeight: 1.3 }
    const sep: LineEl = { ...base('Divider'), kind: 'line', x: CX - 70, y: 148, length: 140, stroke: '#254F22', strokeWidth: 2, lineCap: 'round', dashed: false }
    const body: TextEl = { ...base('Body'), kind: 'text', x: CX - 155, y: 162, text: 'Scan the QR code with your camera to upload your photos and videos.', fontSize: 13, fontFamily: SERIF, fontStyle: 'normal', textDecoration: '', fill: '#555555', align: 'center', width: 310, letterSpacing: 0, lineHeight: 1.5 }
    return { els: [footer, qrEl, body, sep, heading], bg: '#FFFFFF' }
  }

  // bw
  const heading: TextEl = { ...base('Heading'), kind: 'text', x: CX - 200, y: 72, text: title || 'CAPTURE THE MOMENT', fontSize: 30, fontFamily: SERIF, fontStyle: 'bold', textDecoration: '', fill: '#111111', align: 'center', width: 400, letterSpacing: 1, lineHeight: 1.3 }
  const sep: LineEl = { ...base('Divider'), kind: 'line', x: CX - 70, y: 148, length: 140, stroke: '#254F22', strokeWidth: 2, lineCap: 'round', dashed: false }
  const body: TextEl = { ...base('Body'), kind: 'text', x: CX - 155, y: 162, text: 'Scan the QR code with your camera to upload your photos and videos.', fontSize: 13, fontFamily: SERIF, fontStyle: 'normal', textDecoration: '', fill: '#555555', align: 'center', width: 310, letterSpacing: 0, lineHeight: 1.5 }
  const border: RectEl = { ...base('Border'), kind: 'rect', x: 20, y: 20, width: LW - 40, height: LH - 40, fill: 'transparent', stroke: '#111111', strokeWidth: 2, cornerRadius: 0 }
  const border2: RectEl = { ...base('Border inner'), kind: 'rect', x: 32, y: 32, width: LW - 64, height: LH - 64, fill: 'transparent', stroke: '#111111', strokeWidth: 1, cornerRadius: 0 }
  return { els: [border2, border, footer, qrEl, body, sep, heading], bg: '#FFFFFF' }
}

// ─── Undo/redo ────────────────────────────────────────────────────────────────

function useHistory(init: HistState) {
  const [states, setStates] = useState<HistState[]>([init])
  const [idx, setIdx] = useState(0)
  const push = useCallback((s: HistState) => {
    setStates(prev => { const next = [...prev.slice(0, idx + 1), s]; setIdx(next.length - 1); return next })
  }, [idx])
  const replace = useCallback((s: HistState) => { setStates([s]); setIdx(0) }, [])
  const undo = useCallback(() => setIdx(i => Math.max(0, i - 1)), [])
  const redo = useCallback(() => setIdx(i => Math.min(states.length - 1, i + 1)), [states.length])
  const canUndo = idx > 0
  const canRedo = idx < states.length - 1
  return { state: states[idx], push, replace, undo, redo, canUndo, canRedo }
}

// ─── Small UI atoms ───────────────────────────────────────────────────────────

function ColorSwatch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hex, setHex] = useState(value)
  useEffect(() => setHex(value), [value])
  function handle(raw: string) {
    const v = raw.startsWith('#') ? raw : '#' + raw
    setHex(v)
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v)
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative">
        <input type="color" value={value} onChange={e => { setHex(e.target.value); onChange(e.target.value) }}
          className="absolute inset-0 opacity-0 cursor-pointer" style={{ width: 24, height: 24 }} />
        <div className="rounded border" style={{ width: 24, height: 24, background: value, borderColor: '#D0D0D0' }} />
      </div>
      <input type="text" value={hex} onChange={e => handle(e.target.value)} maxLength={7}
        className="rounded border px-1.5 py-0.5 text-xs font-mono" style={{ width: 72, borderColor: '#E0E0E0' }} />
    </div>
  )
}

function NumInput({ label, value, onChange, min, max, step = 1, unit = '' }: { label: string; value: number; min?: number; max?: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  // Local state so mobile keyboards can type freely without re-render kicking them out
  const [local, setLocal] = useState(String(Math.round(value * 10) / 10))
  useEffect(() => { setLocal(String(Math.round(value * 10) / 10)) }, [value])
  function commit(raw: string) {
    const n = parseFloat(raw)
    if (!isNaN(n)) {
      const clamped = min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, n) : n) : n
      onChange(clamped)
    } else { setLocal(String(Math.round(value * 10) / 10)) }
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: '#999' }}>{label}</span>
      <div className="flex items-center gap-1 rounded border px-1.5 py-1" style={{ borderColor: '#E0E0E0' }}>
        <input
          type="text" inputMode="decimal" value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { commit(local); e.currentTarget.blur() } }}
          className="w-full text-xs bg-transparent outline-none" style={{ color: '#1A1A1A' }} />
        {unit && <span className="text-xs shrink-0" style={{ color: '#999' }}>{unit}</span>}
      </div>
    </div>
  )
}

function SliderRow({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs shrink-0 w-16" style={{ color: '#666' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="flex-1" />
      <span className="text-xs w-8 text-right font-mono" style={{ color: '#999' }}>{Math.round(value * 10) / 10}</span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CardEditorClient() {
  const params = useSearchParams()
  const router = useRouter()
  const shareUrl    = params.get('url') ?? ''
  const initialTitle = params.get('title') ?? ''

  const LS_KEY = 'hushare_card_v1'
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const { state, push, replace, undo, redo, canUndo, canRedo } = useHistory({ els: [], bg: '#FFFFFF' })
  const { els, bg } = state
  function setEls(next: El[] | ((p: El[]) => El[]), commit = true) {
    const newEls = typeof next === 'function' ? next(els) : next
    if (commit) push({ els: newEls, bg })
    else _setElsNoHistory(newEls)
  }
  const [_transientEls, _setElsNoHistory] = useState<El[]>([])
  const liveEls = _transientEls.length > 0 ? _transientEls : els

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [transforming, setTransforming] = useState(false)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [rotAngle, setRotAngle] = useState<number | null>(null)
  const [dragLayerId, setDragLayerId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [tool, setTool] = useState<'select'|'text'|'rect'|'ellipse'|'line'|'image'>('select')
  const [guides, setGuides] = useState({ v: false, h: false, vx: CX, hy: CY })
  const [fontsReady, setFontsReady] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [loadedImgs, setLoadedImgs] = useState<Record<string, HTMLImageElement>>({})
  const [rightTab, setRightTab] = useState<'props'|'layers'>('props')
  const [stageW, setStageW] = useState(LW)
  const stageH = Math.round(stageW * LH / LW)
  const scale = stageW / LW
  const dlRatio = 1200 / stageW

  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const shapeRefs = useRef<Record<string, Konva.Node>>({})
  const stageContainer = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gestureRef = useRef<{ active: boolean; startAngle: number; startRot: number; startDist: number; startScale: number }>({ active: false, startAngle: 0, startRot: 0, startDist: 0, startScale: 1 })
  const isDragging = useRef(false)
  const copiedEl = useRef<El | null>(null)

  // Load extra fonts (only for card editor) then force canvas redraw once they're ready
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,700;1,400&family=Dancing+Script:wght@400;700&family=Raleway:wght@400;700&family=Oswald:wght@400;700&display=swap'
    link.onload = () => {
      // CSS is parsed — now wait for the actual font binary data to be ready
      Promise.allSettled([
        document.fonts.load("400 14px Montserrat"),
        document.fonts.load("400 14px Raleway"),
        document.fonts.load("400 14px Oswald"),
        document.fonts.load("400 14px 'Dancing Script'"),
      ]).then(() => stageRef.current?.batchDraw())
    }
    document.head.appendChild(link)
    return () => { try { document.head.removeChild(link) } catch { /* already removed */ } }
  }, [])

  // Stage sizing
  useEffect(() => {
    function update() {
      const sidebar = window.innerWidth >= 1024 ? 56 + 256 : 0
      setStageW(Math.min(LW, window.innerWidth - sidebar - 48))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Prevent native pinch on canvas
  useEffect(() => {
    const el = stageContainer.current
    if (!el) return
    const fn = (e: TouchEvent) => { if (e.touches.length >= 2) e.preventDefault() }
    el.addEventListener('touchmove', fn, { passive: false })
    return () => el.removeEventListener('touchmove', fn)
  }, [])

  // Fonts
  useEffect(() => {
    document.fonts.ready.then(() =>
      Promise.all([
        document.fonts.load("bold 32px 'Playfair Display'"),
        document.fonts.load("400 14px 'Playfair Display'"),
      ]).finally(() => setFontsReady(true))
    )
  }, [])

  // QR + init
  useEffect(() => {
    if (!shareUrl) return
    QRCode.toDataURL(shareUrl, { width: 400, margin: 1, color: { dark: '#111111', light: '#FFFFFF' } }).then(url => {
      setQrDataUrl(url)
      const t = template(initialTitle, url, 'branded')
      replace({ els: t.els, bg: t.bg })  // replace so undo can't go past this
    })
  }, [shareUrl, initialTitle])  // eslint-disable-line

  // Load from localStorage when opened without a shareUrl
  useEffect(() => {
    if (shareUrl) return
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as HistState
      if (Array.isArray(saved.els) && saved.els.length > 0) replace(saved)
    } catch { /* ignore */ }
  }, [])  // eslint-disable-line

  // Auto-save to localStorage on every committed state change
  useEffect(() => {
    if (els.length === 0) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ els, bg }))
        setSavedAt(Date.now())
      } catch { /* quota exceeded */ }
    }, 600)
    return () => clearTimeout(t)
  }, [els, bg])  // eslint-disable-line

  // Load images
  useEffect(() => {
    liveEls.filter((e): e is ImgEl => e.kind === 'image').filter(e => !loadedImgs[e.src]).forEach(e => {
      const img = new Image()
      img.onload = () => setLoadedImgs(p => ({ ...p, [e.src]: img }))
      img.src = e.src
    })
  }, [liveEls, loadedImgs])

  // Transformer sync
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const node = selectedId ? shapeRefs.current[selectedId] : null
    tr.nodes(node ? [node] : [])
    if (node && transforming) {
      tr.enabledAnchors(['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'])
      tr.rotateEnabled(true)
    } else if (node) {
      tr.enabledAnchors([])
      tr.rotateEnabled(false)
    }
    tr.getLayer()?.batchDraw()
  }, [selectedId, transforming, liveEls])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inp = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') { setSelectedId(null); setTransforming(false) }
      if (!inp) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { deleteEl(selectedId); return }
        if (e.ctrlKey || e.metaKey) {
          if (e.key === 'z') { e.preventDefault(); undo() }
          if (e.key === 'y' || (e.shiftKey && e.key === 'z')) { e.preventDefault(); redo() }
          if (e.key === 'd' && selectedId) { e.preventDefault(); duplicateEl(selectedId) }
          if (e.key === 'c' && selectedId) { e.preventDefault(); const el = liveEls.find(x => x.id === selectedId); if (el) copiedEl.current = el }
          if (e.key === 'v' && copiedEl.current) { e.preventDefault(); pasteEl(copiedEl.current) }
          if (e.key === ']' && selectedId) { e.preventDefault(); moveLayer(selectedId, 1) }
          if (e.key === '[' && selectedId) { e.preventDefault(); moveLayer(selectedId, -1) }
        }
        // Arrow nudge
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && selectedId) {
          e.preventDefault()
          const d = e.shiftKey ? 10 : 1
          const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
          const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
          setEls(p => p.map(el => el.id === selectedId ? { ...el, x: el.x + dx, y: el.y + dy } : el))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, undo, redo, deleteEl, duplicateEl, pasteEl, moveLayer, setEls, liveEls])

  const selected = useMemo(() => liveEls.find(e => e.id === selectedId) ?? null, [liveEls, selectedId])

  // ─── Element CRUD ──────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function updateEl(id: string, patch: Record<string, any>, commit = true) {
    setEls(p => p.map(e => e.id === id ? { ...e, ...patch } : e), commit)
  }

  function deleteEl(id: string) {
    setEls(p => p.filter(e => e.id !== id)); setSelectedId(null); setTransforming(false)
  }

  function duplicateEl(id: string) {
    const el = liveEls.find(e => e.id === id)
    if (!el) return
    const dup = { ...el, id: uid(), x: el.x + 16, y: el.y + 16, name: el.name + ' copy' }
    const idx = liveEls.findIndex(e => e.id === id)
    setEls(p => [...p.slice(0, idx + 1), dup, ...p.slice(idx + 1)])
    setSelectedId(dup.id)
  }

  function pasteEl(el: El) {
    const dup = { ...el, id: uid(), x: Math.min(el.x + 20, LW - 20), y: Math.min(el.y + 20, LH - 20), name: el.name.replace(/ copy$/, '') + ' copy' }
    setEls(p => [...p, dup])
    setSelectedId(dup.id)
  }

  function moveLayer(id: string, dir: number) {
    setEls(p => {
      const i = p.findIndex(e => e.id === id)
      const ni = Math.max(0, Math.min(p.length - 1, i + dir))
      if (ni === i) return p
      const next = [...p]; [next[i], next[ni]] = [next[ni], next[i]]
      return next
    })
  }

  // ─── Add tools ─────────────────────────────────────────────────────────────

  function addText() {
    const el: TextEl = { ...base('Text'), kind: 'text', x: CX - 150, y: 120, text: 'Your text', fontSize: 22, fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'normal', textDecoration: '', fill: '#111111', align: 'center', width: 300, letterSpacing: 0, lineHeight: 1.4 }
    setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
  }

  function addRect() {
    const el: RectEl = { ...base('Rectangle'), kind: 'rect', x: CX - 80, y: CY - 50, width: 160, height: 100, fill: '#E8F5E9', stroke: '#254F22', strokeWidth: 2, cornerRadius: 8 }
    setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
  }

  function addEllipse() {
    const el: EllipseEl = { ...base('Circle'), kind: 'ellipse', x: CX, y: CY, radiusX: 70, radiusY: 70, fill: '#E8F5E9', stroke: '#254F22', strokeWidth: 2 }
    setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
  }

  function addLine() {
    const el: LineEl = { ...base('Line'), kind: 'line', x: CX - 80, y: CY, length: 160, stroke: '#254F22', strokeWidth: 2, lineCap: 'round', dashed: false }
    setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
  }

  function handleImgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result as string
      const el: ImgEl = { ...base('Image'), kind: 'image', x: CX - 80, y: CY - 80, src, width: 160, height: 160 }
      setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
    }
    reader.readAsDataURL(file); e.target.value = ''
  }

  function applyTemplate(style: 'branded'|'bw'|'clean') {
    if (!qrDataUrl) return
    const t = template(initialTitle, qrDataUrl, style)
    push({ els: t.els, bg: t.bg })
    setSelectedId(null)
  }

  // ─── Drag/Transform handlers ───────────────────────────────────────────────

  function handleDragMove(id: string, e: KonvaEventObject<DragEvent>) {
    const node = e.target; const el = liveEls.find(e => e.id === id)
    if (!el) return
    let hw = 0, hh = 0
    if (el.kind === 'text')    { hw = el.width / 2 }
    if (el.kind === 'rect')    { hw = el.width / 2; hh = el.height / 2 }
    if (el.kind === 'ellipse') { hw = el.radiusX; hh = el.radiusY }
    if (el.kind === 'line')    { hw = el.length / 2 }
    if (el.kind === 'image')   { hw = el.width / 2; hh = el.height / 2 }
    const cx = node.x() + hw, cy = node.y() + hh
    const snapV = Math.abs(cx - CX) < SNAP, snapH = Math.abs(cy - CY) < SNAP
    if (snapV) node.x(CX - hw)
    if (snapH) node.y(CY - hh)
    setGuides({ v: snapV, h: snapH, vx: CX, hy: CY })
    _setElsNoHistory(p => (p.length ? p : els).map(e => e.id === id ? { ...e, x: node.x(), y: node.y() } : e))
  }

  function handleDragEnd(id: string, e: KonvaEventObject<DragEvent>) {
    setGuides({ v: false, h: false, vx: CX, hy: CY })
    _setElsNoHistory([])
    setEls(p => p.map(el => el.id === id ? { ...el, x: e.target.x(), y: e.target.y() } : el))
  }

  function handleTransformEnd(id: string, e: KonvaEventObject<Event>) {
    const node = e.target; const el = liveEls.find(e => e.id === id); if (!el) return
    const sx = node.scaleX(), sy = node.scaleY()
    if (el.kind === 'text')    updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), fontSize: Math.max(6, Math.round(el.fontSize * sy)), width: Math.max(40, Math.round(el.width * sx)) })
    else if (el.kind === 'rect')    updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), width: Math.max(4, Math.round(el.width * sx)), height: Math.max(4, Math.round(el.height * sy)) })
    else if (el.kind === 'ellipse') updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), radiusX: Math.max(2, Math.round(el.radiusX * sx)), radiusY: Math.max(2, Math.round(el.radiusY * sy)) })
    else if (el.kind === 'line')    updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), length: Math.max(4, Math.round(el.length * sx)) })
    else if (el.kind === 'image')   updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), width: Math.max(4, Math.round(el.width * sx)), height: Math.max(4, Math.round(el.height * sy)) })
    node.scaleX(1); node.scaleY(1)
  }

  // ─── Two-finger rotate/scale (delta-from-start approach) ──────────────────

  function onTouchStart(e: KonvaEventObject<TouchEvent>) {
    if (e.evt.touches.length === 2 && selectedId) {
      const t1 = e.evt.touches[0], t2 = e.evt.touches[1]
      const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY
      const el = liveEls.find(e => e.id === selectedId)
      gestureRef.current = {
        active: true,
        startAngle: Math.atan2(dy, dx),
        startRot: el?.rotation ?? 0,
        startDist: Math.sqrt(dx * dx + dy * dy),
        startScale: 1,
      }
    }
  }

  function onTouchMove(e: KonvaEventObject<TouchEvent>) {
    const g = gestureRef.current
    if (!g.active || e.evt.touches.length !== 2 || !selectedId) return
    const t1 = e.evt.touches[0], t2 = e.evt.touches[1]
    const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY
    const angle = Math.atan2(dy, dx)
    let delta = (angle - g.startAngle) * 180 / Math.PI
    // Clamp large jumps (finger crossing)
    while (delta > 180) delta -= 360
    while (delta < -180) delta += 360
    const newRot = g.startRot + delta
    const node = shapeRefs.current[selectedId]
    if (node) { node.rotation(newRot); node.getLayer()?.batchDraw() }
  }

  function onTouchEnd() {
    if (gestureRef.current.active && selectedId) {
      const node = shapeRefs.current[selectedId]
      if (node) updateEl(selectedId, { rotation: node.rotation() })
    }
    gestureRef.current.active = false
  }

  // ─── Canvas click (add element on click for non-select tools) ─────────────

  function onStageClick(e: KonvaEventObject<MouseEvent>) {
    if (e.target !== e.target.getStage() && e.target.getParent()?.className !== 'Layer') {
      return  // clicked an element, not background
    }
    if (tool === 'text')    { addText(); return }
    if (tool === 'rect')    { addRect(); return }
    if (tool === 'ellipse') { addEllipse(); return }
    if (tool === 'line')    { addLine(); return }
    if (tool === 'select')  { setSelectedId(null); setTransforming(false) }
  }

  // ─── Download ─────────────────────────────────────────────────────────────

  async function download() {
    if (!stageRef.current) return
    setSelectedId(null); setTransforming(false); setDownloading(true)
    await new Promise(r => setTimeout(r, 80))
    try {
      const url = stageRef.current.toDataURL({ pixelRatio: dlRatio, mimeType: 'image/png' })
      const a = document.createElement('a')
      a.download = `${(initialTitle || 'card').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-table-card.png`
      a.href = url; a.click()
    } finally { setDownloading(false) }
  }

  // ─── Inline text commit ────────────────────────────────────────────────────

  function commitTextEdit() {
    if (!editingTextId || !textareaRef.current) return
    const newText = textareaRef.current.value
    updateEl(editingTextId, { text: newText, name: newText.slice(0, 18) || 'Text' })
    setEditingTextId(null)
  }

  // ─── Alignment helpers ─────────────────────────────────────────────────────

  function alignEl(axis: 'cx'|'cy'|'left'|'right'|'top'|'bottom') {
    if (!selectedId) return
    const el = liveEls.find(e => e.id === selectedId); if (!el) return
    let hw = 0, hh = 0
    if (el.kind === 'text')    { hw = el.width / 2 }
    if (el.kind === 'rect')    { hw = el.width / 2;  hh = el.height / 2 }
    if (el.kind === 'ellipse') { hw = el.radiusX;    hh = el.radiusY }
    if (el.kind === 'line')    { hw = el.length / 2 }
    if (el.kind === 'image')   { hw = el.width / 2;  hh = el.height / 2 }
    if (axis === 'cx')     updateEl(el.id, { x: CX - hw })
    if (axis === 'cy')     updateEl(el.id, { y: CY - hh })
    if (axis === 'left')   updateEl(el.id, { x: 0 })
    if (axis === 'right')  updateEl(el.id, { x: LW - hw * 2 })
    if (axis === 'top')    updateEl(el.id, { y: 0 })
    if (axis === 'bottom') updateEl(el.id, { y: LH - hh * 2 })
  }

  // ─── Common Konva props ────────────────────────────────────────────────────

  function kProps(el: El) {
    const locked = el.locked
    return {
      draggable: !locked,
      opacity: el.opacity,
      visible: el.visible,
      shadowEnabled: !!el.shadowEnabled,
      shadowColor: el.shadowColor ?? '#000000',
      shadowBlur: el.shadowBlur ?? 10,
      shadowOffsetX: el.shadowOffsetX ?? 4,
      shadowOffsetY: el.shadowOffsetY ?? 4,
      onClick:    () => { setSelectedId(el.id); setTransforming(false) },
      onTap:      () => { setSelectedId(el.id); setTransforming(false) },
      onDblClick: () => {
        setSelectedId(el.id)
        if (el.kind === 'text') { setEditingTextId(el.id); setTimeout(() => textareaRef.current?.focus(), 20) }
        else setTransforming(true)
      },
      onDblTap: () => { setSelectedId(el.id); setTransforming(true) },
      onDragStart: () => { isDragging.current = true },
      onDragMove: (e: KonvaEventObject<DragEvent>) => handleDragMove(el.id, e),
      onDragEnd:  (e: KonvaEventObject<DragEvent>) => { isDragging.current = false; handleDragEnd(el.id, e) },
      onTransformEnd: (e: KonvaEventObject<Event>) => handleTransformEnd(el.id, e),
      ref: (node: Konva.Node | null) => {
        if (node) shapeRefs.current[el.id] = node
        else delete shapeRefs.current[el.id]
      },
    }
  }

  // ─── Properties panel ─────────────────────────────────────────────────────

  function PropsPanel() {
    if (!selected) return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: '#555' }}>Background</p>
          <ColorSwatch value={bg} onChange={v => push({ els, bg: v })} />
        </div>
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: '#555' }}>Templates</p>
          <div className="space-y-1.5">
            {(['branded','bw','clean'] as const).map(s => (
              <button key={s} onClick={() => applyTemplate(s)}
                className="w-full text-xs font-medium rounded-lg px-3 py-2 text-left transition hover:opacity-80"
                style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
                {s === 'branded' ? 'Hushare Branded (red)' : s === 'bw' ? 'B&W Elegant' : 'Clean White'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs" style={{ color: '#AAAAAA' }}>Click an element to edit. Double-click to resize/rotate. Two fingers to rotate on mobile.</p>
      </div>
    )

    const s = selected
    return (
      <div className="space-y-3">
        {/* Position & Size */}
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: '#555' }}>Position & Size</p>
          <div className="grid grid-cols-2 gap-2">
            <NumInput label="X" value={s.x} onChange={v => updateEl(s.id, { x: v })} />
            <NumInput label="Y" value={s.y} onChange={v => updateEl(s.id, { y: v })} />
            {'width' in s && <NumInput label="W" value={(s as RectEl).width} min={1} onChange={v => updateEl(s.id, { width: v })} />}
            {(s.kind === 'rect' || s.kind === 'image') && <NumInput label="H" value={s.height} min={1} onChange={v => updateEl(s.id, { height: v })} />}
            {s.kind === 'line' && <NumInput label="Length" value={s.length} min={1} onChange={v => updateEl(s.id, { length: v })} />}
            {s.kind === 'ellipse' && <NumInput label="Rx" value={s.radiusX} min={1} onChange={v => updateEl(s.id, { radiusX: v })} />}
            {s.kind === 'ellipse' && <NumInput label="Ry" value={s.radiusY} min={1} onChange={v => updateEl(s.id, { radiusY: v })} />}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <NumInput label="Rotation" value={s.rotation} onChange={v => updateEl(s.id, { rotation: v })} unit="°" />
            <NumInput label="Opacity" value={Math.round(s.opacity * 100)} min={0} max={100} onChange={v => updateEl(s.id, { opacity: v / 100 })} unit="%" />
          </div>
        </div>

        {/* Text props */}
        {s.kind === 'text' && (
          <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
            <p className="text-xs font-semibold" style={{ color: '#555' }}>Text</p>
            <textarea value={s.text} onChange={e => updateEl(s.id, { text: e.target.value })}
              className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: '#E0E0E0', resize: 'vertical', minHeight: 56 }} />
            <div className="flex gap-1.5">
              <div className="flex-1">
                <span className="text-[10px] uppercase tracking-wide" style={{ color: '#999' }}>Size</span>
                <div className="flex items-center gap-1 rounded border px-1.5 py-1 mt-0.5" style={{ borderColor: '#E0E0E0' }}>
                  <input type="number" value={s.fontSize} min={6} max={200} onChange={e => updateEl(s.id, { fontSize: Number(e.target.value) })} className="w-full text-xs bg-transparent outline-none" />
                  <span className="text-xs" style={{ color: '#999' }}>px</span>
                </div>
              </div>
              <div className="flex-1">
                <span className="text-[10px] uppercase tracking-wide" style={{ color: '#999' }}>Spacing</span>
                <div className="flex items-center gap-1 rounded border px-1.5 py-1 mt-0.5" style={{ borderColor: '#E0E0E0' }}>
                  <input type="number" value={s.letterSpacing} step={0.5} onChange={e => updateEl(s.id, { letterSpacing: Number(e.target.value) })} className="w-full text-xs bg-transparent outline-none" />
                </div>
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wide" style={{ color: '#999' }}>Font</span>
              <select value={s.fontFamily} onChange={e => updateEl(s.id, { fontFamily: e.target.value })}
                className="w-full mt-0.5 rounded border px-2 py-1 text-xs" style={{ borderColor: '#E0E0E0' }}>
                <option value="'Playfair Display', Georgia, serif">Playfair Display</option>
                <option value="'Montserrat', sans-serif">Montserrat</option>
                <option value="'Raleway', sans-serif">Raleway</option>
                <option value="'Oswald', sans-serif">Oswald</option>
                <option value="'Dancing Script', cursive">Dancing Script</option>
                <option value="'Geist', system-ui, sans-serif">Geist Sans</option>
                <option value="'Playwrite GB J', cursive">Playwrite Script</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="'Times New Roman', serif">Times New Roman</option>
              </select>
            </div>
            <div className="flex gap-1">
              {(['normal','bold','italic','bold italic'] as const).map(fs => (
                <button key={fs} onClick={() => updateEl(s.id, { fontStyle: fs })}
                  className="flex-1 text-xs rounded py-1 transition"
                  style={{ background: s.fontStyle === fs ? '#254F22' : '#F5F0E8', color: s.fontStyle === fs ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.fontStyle === fs ? '#254F22' : '#DDD5C5'), fontWeight: fs.includes('bold') ? 700 : 400, fontStyle: fs.includes('italic') ? 'italic' : 'normal' }}>
                  {fs === 'normal' ? 'Aa' : fs === 'bold' ? 'B' : fs === 'italic' ? 'I' : 'BI'}
                </button>
              ))}
              <button onClick={() => updateEl(s.id, { textDecoration: s.textDecoration === 'underline' ? '' : 'underline' })}
                className="flex-1 text-xs rounded py-1 transition"
                style={{ background: s.textDecoration === 'underline' ? '#254F22' : '#F5F0E8', color: s.textDecoration === 'underline' ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.textDecoration === 'underline' ? '#254F22' : '#DDD5C5'), textDecoration: 'underline' }}>
                U
              </button>
            </div>
            <div className="flex gap-1">
              {(['left','center','right'] as const).map(a => (
                <button key={a} onClick={() => updateEl(s.id, { align: a })}
                  className="flex-1 py-1.5 rounded transition"
                  style={{ background: s.align === a ? '#254F22' : '#F5F0E8', color: s.align === a ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.align === a ? '#254F22' : '#DDD5C5') }}>
                  {a === 'left' ? <AlignLeft className="w-3.5 h-3.5 mx-auto" /> : a === 'center' ? <AlignCenter className="w-3.5 h-3.5 mx-auto" /> : <AlignRight className="w-3.5 h-3.5 mx-auto" />}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: '#666' }}>Color</span>
              <ColorSwatch value={s.fill} onChange={v => updateEl(s.id, { fill: v })} />
            </div>
            <SliderRow label="Width" value={s.width} min={40} max={LW - 20} onChange={v => updateEl(s.id, { width: v })} />
            <SliderRow label="Line H" value={s.lineHeight} min={0.8} max={3} step={0.1} onChange={v => updateEl(s.id, { lineHeight: v })} />
          </div>
        )}

        {/* Shape props */}
        {(s.kind === 'rect' || s.kind === 'ellipse') && (
          <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
            <p className="text-xs font-semibold" style={{ color: '#555' }}>Shape</p>
            <div className="flex items-center gap-2"><span className="text-xs w-10" style={{ color: '#666' }}>Fill</span><ColorSwatch value={s.fill} onChange={v => updateEl(s.id, { fill: v })} /></div>
            <div className="flex items-center gap-2"><span className="text-xs w-10" style={{ color: '#666' }}>Stroke</span><ColorSwatch value={s.stroke} onChange={v => updateEl(s.id, { stroke: v })} /></div>
            <SliderRow label="Stroke W" value={s.strokeWidth} min={0} max={20} onChange={v => updateEl(s.id, { strokeWidth: v })} />
            {s.kind === 'rect' && <SliderRow label="Radius" value={s.cornerRadius} min={0} max={80} onChange={v => updateEl(s.id, { cornerRadius: v })} />}
          </div>
        )}

        {/* Line props */}
        {s.kind === 'line' && (
          <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
            <p className="text-xs font-semibold" style={{ color: '#555' }}>Line</p>
            <div className="flex items-center gap-2"><span className="text-xs w-10" style={{ color: '#666' }}>Color</span><ColorSwatch value={s.stroke} onChange={v => updateEl(s.id, { stroke: v })} /></div>
            <SliderRow label="Thickness" value={s.strokeWidth} min={0.5} max={20} step={0.5} onChange={v => updateEl(s.id, { strokeWidth: v })} />
            <div className="flex gap-1">
              <button onClick={() => updateEl(s.id, { lineCap: 'round' })} className="flex-1 text-xs rounded py-1" style={{ background: s.lineCap === 'round' ? '#254F22' : '#F5F0E8', color: s.lineCap === 'round' ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.lineCap === 'round' ? '#254F22' : '#DDD5C5') }}>Rounded</button>
              <button onClick={() => updateEl(s.id, { lineCap: 'butt' })} className="flex-1 text-xs rounded py-1" style={{ background: s.lineCap === 'butt' ? '#254F22' : '#F5F0E8', color: s.lineCap === 'butt' ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.lineCap === 'butt' ? '#254F22' : '#DDD5C5') }}>Square</button>
              <button onClick={() => updateEl(s.id, { dashed: !s.dashed })} className="flex-1 text-xs rounded py-1" style={{ background: s.dashed ? '#254F22' : '#F5F0E8', color: s.dashed ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.dashed ? '#254F22' : '#DDD5C5') }}>Dashed</button>
            </div>
          </div>
        )}

        {/* Image props */}
        {s.kind === 'image' && (
          <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
            <label className="flex items-center justify-center gap-1.5 w-full rounded-lg py-2 text-xs font-semibold cursor-pointer hover:opacity-80"
              style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px dashed #DDD5C5' }}>
              <ImagePlus className="w-3 h-3" /> Replace image
              <input type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
            </label>
          </div>
        )}

        {/* Shadow */}
        <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold" style={{ color: '#555' }}>Shadow</p>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span className="text-xs" style={{ color: '#888' }}>{s.shadowEnabled ? 'On' : 'Off'}</span>
              <input type="checkbox" checked={!!s.shadowEnabled} onChange={e => updateEl(s.id, { shadowEnabled: e.target.checked })} />
            </label>
          </div>
          {s.shadowEnabled && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2"><span className="text-xs w-10 shrink-0" style={{ color: '#666' }}>Color</span><ColorSwatch value={s.shadowColor ?? '#000000'} onChange={v => updateEl(s.id, { shadowColor: v })} /></div>
              <SliderRow label="Blur" value={s.shadowBlur ?? 10} min={0} max={50} onChange={v => updateEl(s.id, { shadowBlur: v })} />
              <SliderRow label="Offset X" value={s.shadowOffsetX ?? 4} min={-30} max={30} onChange={v => updateEl(s.id, { shadowOffsetX: v })} />
              <SliderRow label="Offset Y" value={s.shadowOffsetY ?? 4} min={-30} max={30} onChange={v => updateEl(s.id, { shadowOffsetY: v })} />
            </div>
          )}
        </div>

        {/* Alignment */}
        <div className="pt-2 border-t" style={{ borderColor: '#F0F0F0' }}>
          <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: '#999' }}>Align to canvas</p>
          <div className="grid grid-cols-3 gap-1">
            {([
              ['← Left', 'left'], ['— Center H', 'cx'], ['Right →', 'right'],
              ['↑ Top', 'top'],   ['| Center V', 'cy'], ['↓ Bottom', 'bottom'],
            ] as const).map(([label, axis]) => (
              <button key={axis} onClick={() => alignEl(axis)}
                className="text-[10px] rounded py-1.5 px-1 transition hover:opacity-80"
                style={{ background: '#F5F5F5', color: '#555', border: '1px solid #E0E0E0' }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1.5">
          <button onClick={() => duplicateEl(s.id)} className="flex-1 flex items-center justify-center gap-1 text-xs rounded-lg py-2 transition hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
            <Copy className="w-3 h-3" /> Copy
          </button>
          <button onClick={() => moveLayer(s.id, 1)} className="flex items-center justify-center gap-1 text-xs rounded-lg px-3 py-2 transition hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
            <ChevronUp className="w-3 h-3" />
          </button>
          <button onClick={() => moveLayer(s.id, -1)} className="flex items-center justify-center gap-1 text-xs rounded-lg px-3 py-2 transition hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
            <ChevronDown className="w-3 h-3" />
          </button>
          <button onClick={() => updateEl(s.id, { locked: !s.locked })} className="flex items-center justify-center text-xs rounded-lg px-2.5 py-2"
            style={{ background: s.locked ? '#FFF3E0' : '#F5F5F5', color: s.locked ? '#E65100' : '#888', border: '1px solid ' + (s.locked ? '#FFE0B2' : '#E0E0E0') }}>
            {s.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          </button>
          <button onClick={() => deleteEl(s.id)} className="flex items-center justify-center text-xs rounded-lg px-2.5 py-2"
            style={{ background: '#FFF0F0', color: '#C0392B', border: '1px solid #FFCCCC' }}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {/* Transform toggle */}
        <button onClick={() => setTransforming(t => !t)} className="w-full text-xs font-semibold rounded-lg py-2 transition"
          style={{ background: transforming ? '#E8F5E9' : '#F5F5F5', color: transforming ? '#254F22' : '#555', border: '1px solid ' + (transforming ? '#C8E6C9' : '#E0E0E0') }}>
          {transforming ? '✓ Handles on — dbl-click canvas to edit text' : 'Enable resize / rotate handles (dbl-click)'}
        </button>
      </div>
    )
  }

  // ─── Layers panel ─────────────────────────────────────────────────────────

  function LayersPanel() {
    function dropLayer(targetId: string) {
      if (!dragLayerId || dragLayerId === targetId) return
      setEls(p => {
        const next = [...p]
        const fromIdx = next.findIndex(e => e.id === dragLayerId)
        const toIdx   = next.findIndex(e => e.id === targetId)
        const [item] = next.splice(fromIdx, 1)
        next.splice(toIdx, 0, item)
        return next
      })
      setDragLayerId(null); setDragOverId(null)
    }
    return (
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: '#999' }}>Drag to reorder — top = front</p>
        {[...liveEls].reverse().map(el => (
          <div key={el.id}
            draggable
            onDragStart={() => setDragLayerId(el.id)}
            onDragOver={e => { e.preventDefault(); setDragOverId(el.id) }}
            onDrop={() => dropLayer(el.id)}
            onDragEnd={() => { setDragLayerId(null); setDragOverId(null) }}
            onClick={() => { setSelectedId(el.id); setTransforming(false) }}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing transition select-none"
            style={{
              background: el.id === selectedId ? '#E8F5E9' : el.id === dragOverId ? '#EEF2FF' : 'transparent',
              border: '1px solid ' + (el.id === selectedId ? '#C8E6C9' : el.id === dragOverId ? '#C7D2FE' : 'transparent'),
              opacity: el.id === dragLayerId ? 0.4 : 1,
            }}>
            <span className="text-[10px] w-10 shrink-0 text-center rounded px-1 py-0.5 font-mono uppercase" style={{ background: '#F5F5F5', color: '#888' }}>
              {el.kind.slice(0, 4)}
            </span>
            <span className="flex-1 text-xs truncate" style={{ color: '#1A1A1A' }}>{el.name}</span>
            <button onClick={e => { e.stopPropagation(); updateEl(el.id, { visible: !el.visible }, true) }}
              className="p-1 rounded transition hover:opacity-70">
              {el.visible ? <Eye className="w-3 h-3" style={{ color: '#888' }} /> : <EyeOff className="w-3 h-3" style={{ color: '#BBB' }} />}
            </button>
            <button onClick={e => { e.stopPropagation(); updateEl(el.id, { locked: !el.locked }, true) }}
              className="p-1 rounded transition hover:opacity-70">
              {el.locked ? <Lock className="w-3 h-3" style={{ color: '#E67' }} /> : <Unlock className="w-3 h-3" style={{ color: '#BBB' }} />}
            </button>
            <div className="flex flex-col gap-0">
              <button onClick={e => { e.stopPropagation(); moveLayer(el.id, 1) }} className="p-0.5 hover:opacity-70"><ChevronUp className="w-3 h-3" style={{ color: '#888' }} /></button>
              <button onClick={e => { e.stopPropagation(); moveLayer(el.id, -1) }} className="p-0.5 hover:opacity-70"><ChevronDown className="w-3 h-3" style={{ color: '#888' }} /></button>
            </div>
          </div>
        ))}
        {liveEls.length === 0 && <p className="text-xs py-3 text-center" style={{ color: '#AAAAAA' }}>No elements yet.</p>}
      </div>
    )
  }

  // ─── Tool definitions ─────────────────────────────────────────────────────

  const TOOLS = [
    { id: 'select',  icon: <MousePointer className="w-4 h-4" />,  label: 'Select'    },
    { id: 'text',    icon: <Type className="w-4 h-4" />,           label: 'Text'      },
    { id: 'rect',    icon: <Square className="w-4 h-4" />,         label: 'Rectangle' },
    { id: 'ellipse', icon: <Circle className="w-4 h-4" />,         label: 'Circle'    },
    { id: 'line',    icon: <Minus className="w-4 h-4" />,          label: 'Line'      },
    { id: 'image',   icon: <ImagePlus className="w-4 h-4" />,      label: 'Image'     },
  ] as const

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#F0F0F0', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ background: '#1A1A1A', minHeight: 48 }}>
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 transition hover:opacity-80"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#DDD' }}>
          <ArrowLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Back</span>
        </button>

        <span className="text-sm font-semibold text-white hidden sm:block mx-2">Card Editor</span>

        {savedAt && (
          <span key={savedAt} className="text-[10px] hidden sm:block animate-fade-out"
            style={{ color: '#6EE7B7', opacity: 0.85 }}>
            Saved
          </span>
        )}

        <div className="flex gap-1 ml-1">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
            className="flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 transition disabled:opacity-30"
            style={{ background: canUndo ? 'rgba(255,255,255,0.12)' : 'transparent', color: '#DDD' }}>
            <Undo2 className="w-3.5 h-3.5" /> <span className="hidden md:inline">Undo</span>
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
            className="flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 transition disabled:opacity-30"
            style={{ background: canRedo ? 'rgba(255,255,255,0.12)' : 'transparent', color: '#DDD' }}>
            <Redo2 className="w-3.5 h-3.5" /> <span className="hidden md:inline">Redo</span>
          </button>
        </div>

        <div className="flex-1" />

        {selectedId && (
          <button onClick={() => { setSelectedId(null); setTransforming(false) }}
            className="text-xs rounded-lg px-2.5 py-1.5 hidden sm:flex items-center gap-1"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#BBB' }}>
            <MousePointer className="w-3 h-3" /> Deselect
          </button>
        )}

        <button onClick={download} disabled={downloading}
          className="flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 transition hover:opacity-90 disabled:opacity-40"
          style={{ background: '#254F22', color: '#FDFAF5' }}>
          <Download className="w-3.5 h-3.5" />
          {downloading ? '…' : <><span className="hidden sm:inline">Download</span> PNG</>}
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left toolbar (desktop) ────────────────────────────────────── */}
        <div className="hidden lg:flex flex-col items-center gap-1 py-3 px-1.5 shrink-0"
          style={{ background: '#2A2A2A', width: 56, borderRight: '1px solid #333' }}>
          {TOOLS.map(t => (
            <button key={t.id}
              onClick={() => {
                setTool(t.id as typeof tool)
                if (t.id !== 'select') {
                  if (t.id === 'text') addText()
                  else if (t.id === 'rect') addRect()
                  else if (t.id === 'ellipse') addEllipse()
                  else if (t.id === 'line') addLine()
                }
              }}
              title={t.label}
              className="w-9 h-9 flex items-center justify-center rounded-lg transition"
              style={{ background: tool === t.id ? '#254F22' : 'transparent', color: tool === t.id ? '#FDFAF5' : '#AAA' }}>
              {t.id === 'image' ? (
                <label className="cursor-pointer flex items-center justify-center w-full h-full">
                  {t.icon}
                  <input type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
                </label>
              ) : t.icon}
            </button>
          ))}
          <div className="flex-1" />
          <div className="w-8 h-px" style={{ background: '#444' }} />
          <button onClick={() => push({ els, bg })} title="Save checkpoint" className="w-9 h-9 flex items-center justify-center rounded-lg" style={{ color: '#666' }}>
            ·
          </button>
        </div>

        {/* ── Canvas area ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto flex items-start justify-center p-4 order-1 lg:order-none"
          style={{ background: '#E8E8E8' }}>
          <div ref={stageContainer} style={{ position: 'relative' }}>
            {!fontsReady && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.85)', fontSize: 12, color: '#888' }}>Loading…</div>
            )}

            {/* Rotation angle badge */}
            {rotAngle !== null && (
              <div className="absolute top-2 right-2 z-20 rounded-lg px-2.5 py-1 text-xs font-mono font-bold pointer-events-none"
                style={{ background: 'rgba(0,0,0,0.75)', color: '#FFF', letterSpacing: '0.05em' }}>
                {rotAngle}° {rotAngle === 0 ? '↔' : rotAngle === 90 ? '↕' : rotAngle === 45 || rotAngle === 135 || rotAngle === 225 || rotAngle === 315 ? '✕' : ''}
              </div>
            )}

            {/* Inline text editor overlay (desktop) */}
            {editingTextId && (() => {
              const el = liveEls.find(e => e.id === editingTextId)
              if (!el || el.kind !== 'text') return null
              return (
                <textarea
                  ref={textareaRef}
                  defaultValue={el.text}
                  onBlur={commitTextEdit}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setEditingTextId(null) }
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit() }
                    // Shift+Enter → inserts newline (default textarea behavior)
                  }}
                  style={{
                    position: 'absolute',
                    left: el.x * scale,
                    top: el.y * scale,
                    width: el.width * scale,
                    minHeight: el.fontSize * scale * 1.5,
                    fontSize: el.fontSize * scale,
                    fontFamily: el.fontFamily,
                    fontStyle: el.fontStyle.includes('italic') ? 'italic' : 'normal',
                    fontWeight: el.fontStyle.includes('bold') ? 700 : 400,
                    color: el.fill,
                    textAlign: el.align,
                    background: 'rgba(255,255,255,0.92)',
                    border: '2px dashed #3B82F6',
                    borderRadius: 4,
                    outline: 'none',
                    resize: 'none',
                    padding: '2px 4px',
                    lineHeight: el.lineHeight,
                    letterSpacing: el.letterSpacing,
                    transform: el.rotation !== 0 ? `rotate(${el.rotation}deg)` : undefined,
                    transformOrigin: 'top left',
                    zIndex: 20,
                    overflow: 'hidden',
                    boxSizing: 'border-box',
                  }}
                />
              )
            })()}
            <Stage
              ref={stageRef}
              width={stageW}
              height={stageH}
              scaleX={scale}
              scaleY={scale}
              style={{ borderRadius: 8, boxShadow: '0 8px 48px rgba(0,0,0,0.25)', cursor: tool === 'select' ? 'default' : 'crosshair', display: 'block' }}
              onClick={onStageClick}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <Layer>
                <KRect x={0} y={0} width={LW} height={LH} fill={bg} />

                {liveEls.map(el => {
                  const p = kProps(el)
                  if (el.kind === 'text')    return <Text key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} text={el.text} fontSize={el.fontSize} fontFamily={el.fontFamily} fontStyle={el.fontStyle} textDecoration={el.textDecoration} fill={el.fill} align={el.align} width={el.width} letterSpacing={el.letterSpacing} lineHeight={el.lineHeight} wrap="word" />
                  if (el.kind === 'rect')    return <KRect key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} width={el.width} height={el.height} fill={el.fill} stroke={el.stroke} strokeWidth={el.strokeWidth} cornerRadius={el.cornerRadius} />
                  if (el.kind === 'ellipse') return <Ellipse key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} radiusX={el.radiusX} radiusY={el.radiusY} fill={el.fill} stroke={el.stroke} strokeWidth={el.strokeWidth} />
                  if (el.kind === 'line')    return <Line key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} points={[0, 0, el.length, 0]} stroke={el.stroke} strokeWidth={el.strokeWidth} lineCap={el.lineCap} dash={el.dashed ? [el.strokeWidth * 3, el.strokeWidth * 2] : []} hitStrokeWidth={16} />
                  if (el.kind === 'image') {
                    const img = loadedImgs[el.src]; if (!img) return null
                    return <KonvaImage key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} image={img} width={el.width} height={el.height} />
                  }
                  return null
                })}

                {guides.v && <Line points={[guides.vx, 0, guides.vx, LH]} stroke="#3B82F6" strokeWidth={1} dash={[5, 4]} listening={false} />}
                {guides.h && <Line points={[0, guides.hy, LW, guides.hy]} stroke="#3B82F6" strokeWidth={1} dash={[5, 4]} listening={false} />}

                <Transformer
                  ref={trRef}
                  boundBoxFunc={(o, n) => (n.width < 8 || n.height < 8 ? o : n)}
                  anchorSize={8} anchorCornerRadius={3}
                  borderStroke="#3B82F6" anchorStroke="#3B82F6" anchorFill="#FFFFFF"
                  rotateAnchorOffset={20}
                  rotateAnchorCursor={`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M17.65 6.35A7.96 7.96 0 0 0 12 4c-4.42 0-8 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z' fill='%23111111'/%3E%3C/svg%3E") 12 12, crosshair`}
                  rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                  rotationSnapTolerance={8}
                  onTransform={() => {
                    const node = trRef.current?.nodes()[0]
                    if (node) setRotAngle(Math.round(node.rotation()))
                  }}
                  onTransformEnd={() => setTimeout(() => setRotAngle(null), 800)}
                />
              </Layer>
            </Stage>
          </div>
        </div>

        {/* ── Right panel (desktop) ─────────────────────────────────────── */}
        <div className="hidden lg:flex flex-col shrink-0 overflow-hidden"
          style={{ width: 256, background: '#FFFFFF', borderLeft: '1px solid #E5E5E5' }}>
          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: '#E5E5E5' }}>
            {(['props','layers'] as const).map(tab => (
              <button key={tab} onClick={() => setRightTab(tab)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition"
                style={{ borderBottom: rightTab === tab ? '2px solid #254F22' : '2px solid transparent', color: rightTab === tab ? '#254F22' : '#888' }}>
                {tab === 'layers' && <Layers className="w-3.5 h-3.5" />}
                {tab === 'props' ? 'Properties' : 'Layers'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {rightTab === 'props' ? PropsPanel() : LayersPanel()}
          </div>
        </div>

      </div>

      {/* ── Mobile bottom bar ─────────────────────────────────────────────── */}
      <div className="lg:hidden flex flex-col shrink-0" style={{ background: '#FFFFFF', borderTop: '1px solid #E5E5E5' }}>
        {/* Tool strip */}
        <div className="flex overflow-x-auto gap-1 px-2 py-2" style={{ scrollbarWidth: 'none' }}>
          {TOOLS.map(t => (
            <button key={t.id}
              onClick={() => {
                setTool(t.id as typeof tool)
                if (t.id === 'text') addText()
                else if (t.id === 'rect') addRect()
                else if (t.id === 'ellipse') addEllipse()
                else if (t.id === 'line') addLine()
              }}
              className="flex flex-col items-center gap-0.5 shrink-0 rounded-xl px-3 py-2 transition"
              style={{ background: tool === t.id ? '#254F22' : '#F5F5F5', color: tool === t.id ? '#FDFAF5' : '#555' }}>
              {t.id === 'image' ? (
                <label className="cursor-pointer flex flex-col items-center gap-0.5">
                  {t.icon}<span className="text-[10px]">{t.label}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
                </label>
              ) : <>{t.icon}<span className="text-[10px]">{t.label}</span></>}
            </button>
          ))}
        </div>

        {/* Mobile properties (collapsed) */}
        {selected && (
          <div className="px-3 pb-3 max-h-64 overflow-y-auto border-t" style={{ borderColor: '#F0F0F0' }}>
            {PropsPanel()}
          </div>
        )}
      </div>

    </div>
  )
}
