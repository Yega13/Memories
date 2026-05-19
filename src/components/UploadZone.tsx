'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase, type Album } from '@/lib/supabase'
import {
  detectKind,
  extensionFor,
  generateVideoPoster,
  DEFAULT_UPLOAD_CAPS,
  type MediaKind,
} from '@/lib/media'
import { formatFileSize } from '@/lib/utils'
import { MEDIA_AUTHOR_MAX, MEDIA_CAPTION_MAX } from '@/lib/media-text'
import { showAppToast } from '@/components/AppToast'
import { Upload, X, Film, ImageIcon } from 'lucide-react'

type R2UploadResult = { storage_path: string; url: string }

async function uploadToR2(
  file: File | Blob,
  albumId: string,
  filename: string,
  kind: 'video' | 'poster',
  onProgress?: (percent: number) => void,
): Promise<R2UploadResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('albumId', albumId)
  form.append('filename', filename)
  form.append('kind', kind)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload/r2')
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress?.(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      let body: { error?: string; storage_path?: string; url?: string } = {}
      try {
        body = JSON.parse(xhr.responseText || '{}')
      } catch {
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(body.error || `R2 upload returned ${xhr.status}`))
        return
      }
      if (!body.storage_path || !body.url) {
        reject(new Error('R2 upload response was missing file details'))
        return
      }
      resolve({ storage_path: body.storage_path, url: body.url })
    }
    xhr.onerror = () => reject(new Error('Network error during R2 upload'))
    xhr.send(form)
  })
}

// Large video upload via R2 multipart — splits the file into chunks each sent through the Worker
// (under Cloudflare's 100 MB body limit). 25 MB feels right: smaller per-chunk failures cost
// less to retry, and on mobile data 25 MB finishes in 40 s at 5 Mbps — well within any timeout.
const CHUNK_SIZE = 25 * 1024 * 1024

async function uploadVideoMultipart(
  file: File,
  albumId: string,
  filename: string,
  onProgress?: (percent: number) => void,
): Promise<R2UploadResult> {
  // Step 1: init
  const initRes = await fetch('/api/upload/r2/multipart?action=init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumId, filename, contentType: file.type || 'video/mp4', totalSize: file.size }),
  })
  let initBody: { error?: string; uploadId?: string; key?: string } = {}
  try { initBody = await initRes.json() } catch { /* ignore */ }
  if (!initRes.ok) throw new Error(initBody.error || `Upload init failed: ${initRes.status}`)
  const { uploadId, key } = initBody
  if (!uploadId || !key) throw new Error('Invalid upload init response')

  // Step 2: upload chunks sequentially (each is a separate Worker request).
  // Each chunk is retried up to 3 times on transient failures — without this, a single
  // dropped TCP connection on flaky mobile data would tank the entire video upload.
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  const parts: { partNumber: number; etag: string }[] = []
  let uploadedBytes = 0

  async function uploadChunkOnce(partNumber: number, chunk: Blob, end: number, start: number) {
    return new Promise<{ partNumber: number; etag: string }>((resolve, reject) => {
      // Raw body — no FormData. The server reads metadata from query params and streams the
      // chunk straight through to R2 instead of buffering 25 MB of form-encoded data.
      const params = new URLSearchParams({
        action: 'chunk',
        uploadId: uploadId!,
        key: key!,
        partNumber: String(partNumber),
      })
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/upload/r2/multipart?${params.toString()}`)
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        const chunkUploaded = event.loaded / event.total * (end - start)
        onProgress?.(Math.round((uploadedBytes + chunkUploaded) / file.size * 95))
      }
      xhr.onload = () => {
        let body: { error?: string; partNumber?: number; etag?: string } = {}
        try { body = JSON.parse(xhr.responseText || '{}') } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && body.partNumber && body.etag) {
          resolve({ partNumber: body.partNumber, etag: body.etag })
        } else {
          reject(new Error(body.error || `Chunk ${partNumber} failed: ${xhr.status}`))
        }
      }
      xhr.onerror = () => reject(new Error(`Network error on chunk ${partNumber}`))
      xhr.ontimeout = () => reject(new Error(`Timeout on chunk ${partNumber}`))
      // 3-minute per-chunk timeout — covers slow mobile data on a 25 MB chunk.
      xhr.timeout = 180_000
      xhr.send(chunk)
    })
  }

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const chunk = file.slice(start, end)
    const partNumber = i + 1

    let part: { partNumber: number; etag: string } | null = null
    let lastErr: Error | null = null
    // 5 attempts with exponential-ish backoff. Mobile data drops can take seconds to recover.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        part = await uploadChunkOnce(partNumber, chunk, end, start)
        break
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e))
        if (attempt < 5) await wait(1500 * attempt)
      }
    }
    if (!part) {
      fetch('/api/upload/r2/multipart?action=abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, key }),
      }).catch(() => {})
      throw lastErr ?? new Error(`Chunk ${partNumber} failed`)
    }

    parts.push(part)
    uploadedBytes += end - start
    onProgress?.(Math.round(uploadedBytes / file.size * 95))
  }

  // Step 3: complete
  const completeRes = await fetch('/api/upload/r2/multipart?action=complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, key, parts }),
  })
  let completeBody: { error?: string; storage_path?: string; url?: string } = {}
  try { completeBody = await completeRes.json() } catch { /* ignore */ }
  if (!completeRes.ok) {
    // Best-effort abort to avoid leaving incomplete uploads in R2
    fetch('/api/upload/r2/multipart?action=abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, key }),
    }).catch(() => {})
    throw new Error(completeBody.error || `Upload complete failed: ${completeRes.status}`)
  }
  const { storage_path, url } = completeBody
  if (!storage_path || !url) throw new Error('Invalid upload complete response')
  return { storage_path, url }
}

type Props = {
  album: Album
  onPhotoAdded: () => void
}

type PendingItem = {
  file: File
  preview: string
  kind: MediaKind
  caption: string
  author: string
}

type UploadStatus = {
  fileName: string
  index: number
  total: number
  phase: string
  percent: number
}

type PhotoInsertRow = {
  storage_path: string
  storage_backend: 'supabase' | 'r2'
  url: string
  caption: string | null
  author_name: string | null
  media_type: 'image' | 'video'
  poster_path: string | null
  poster_url: string | null
  duration_seconds: number | null
}

// Files above this threshold use multipart chunked upload. Below it, the file is sent as a
// single Worker request. Match the threshold to the chunk size so a file just over the threshold
// gets split into ~2 chunks, not 1.
const MULTIPART_THRESHOLD = 25 * 1024 * 1024

const HEIC_EXT_RE = /\.(heic|heif)$/i
const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])
const FILE_ACCEPT = 'image/*,video/*,.heic,.heif,image/heic,image/heif,image/heic-sequence,image/heif-sequence'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isRetriableStorageError(message: string): boolean {
  return /failed to fetch|network|timeout|abort/i.test(message)
}

function isExistingObjectError(message: string): boolean {
  return /already exists|duplicate|resource already exists/i.test(message)
}

function isHeicFile(file: File): boolean {
  return HEIC_MIME_TYPES.has(file.type.toLowerCase()) || HEIC_EXT_RE.test(file.name)
}

function jpegNameFor(file: File): string {
  const withoutExt = file.name.replace(/\.[^.]+$/, '')
  return `${withoutExt || 'photo'}.jpg`
}

const HEIC_CONVERSION_TIMEOUT_MS = 60_000

// Lazily-created singleton worker. We reuse one worker across all conversions to avoid the cost
// of spinning up libheif WASM for each file.
let heicWorker: Worker | null = null
let heicJobId = 0
const heicJobs = new Map<number, { resolve: (jpeg: Blob) => void; reject: (err: Error) => void }>()

function getHeicWorker(): Worker {
  if (heicWorker) return heicWorker
  // The worker bundle is built from src/lib/heic-worker.ts. Next.js + Webpack can resolve
  // `new Worker(new URL('./...', import.meta.url))` automatically.
  heicWorker = new Worker(new URL('@/lib/heic-worker.ts', import.meta.url), { type: 'module' })
  heicWorker.addEventListener('message', (e: MessageEvent<{ id: number; jpeg?: Blob; error?: string }>) => {
    const { id, jpeg, error } = e.data
    const job = heicJobs.get(id)
    if (!job) return
    heicJobs.delete(id)
    if (jpeg) job.resolve(jpeg)
    else job.reject(new Error(error ?? 'HEIC conversion failed'))
  })
  return heicWorker
}

async function convertHeicToJpeg(file: File): Promise<File> {
  // Convert in a Web Worker so libheif WASM doesn't block the main thread. Without this the
  // page freezes for the full duration of the conversion and any timeout fires only after the
  // worker has actually returned (defeating the purpose).
  const worker = getHeicWorker()
  const id = ++heicJobId
  const blob: Blob = await new Promise<Blob>((resolve, reject) => {
    heicJobs.set(id, { resolve, reject })
    window.setTimeout(() => {
      if (!heicJobs.has(id)) return
      heicJobs.delete(id)
      reject(new Error('HEIC conversion timed out'))
    }, HEIC_CONVERSION_TIMEOUT_MS)
    worker.postMessage({ id, blob: file })
  })
  return new File([blob], jpegNameFor(file), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  })
}

export default function UploadZone({ album, onPhotoAdded }: Props) {
  const [pending, setPending] = useState<PendingItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<PendingItem[]>([])

  const caps = album.upload_caps ?? DEFAULT_UPLOAD_CAPS

  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  useEffect(() => {
    if (!uploading) return
    function onVisibilityChange() {
      if (document.hidden) {
        showAppToast('Keep this tab open — upload is in progress.', 'error')
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [uploading])

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((item) => URL.revokeObjectURL(item.preview))
    }
  }, [])

  async function addFiles(files: FileList | null) {
    if (uploading || preparing) return
    if (!files) return
    setPreparing(true)
    const next: PendingItem[] = []
    const rejected: string[] = []

    const filesArr = Array.from(files)
    for (let idx = 0; idx < filesArr.length; idx++) {
      const file = filesArr[idx]
      const kind = detectKind(file)
      if (!kind) {
        rejected.push(`${file.name}: unsupported file type`)
        continue
      }
      const cap = kind === 'video' ? caps.video : caps.image
      if (file.size > cap) {
        rejected.push(
          `${file.name}: ${formatFileSize(file.size)} exceeds ${formatFileSize(cap)} limit`,
        )
        continue
      }

      let uploadFile = file
      if (kind === 'image' && isHeicFile(file)) {
        // Yield to the browser before each HEIC conversion so the "Preparing…" UI can repaint.
        // heic2any blocks the main thread for a few seconds per file; without yielding the user
        // sees a frozen page.
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)))
        try {
          uploadFile = await convertHeicToJpeg(file)
        } catch (err) {
          const msg = err instanceof Error && err.message === 'HEIC conversion timed out'
            ? `${file.name}: HEIC conversion took too long — file may be corrupted`
            : `${file.name}: could not convert HEIC to JPG`
          rejected.push(msg)
          continue
        }
        if (uploadFile.size > cap) {
          rejected.push(
            `${file.name}: converted JPG is ${formatFileSize(uploadFile.size)}, above the ${formatFileSize(cap)} limit`,
          )
          continue
        }
      }

      next.push({
        file: uploadFile,
        preview: URL.createObjectURL(uploadFile),
        kind,
        caption: '',
        author: '',
      })
    }

    if (rejected.length) {
      const message = rejected.join(' - ')
      setUploadError(message)
      showAppToast(message, 'error')
    } else {
      setUploadError('')
    }
    setPending((prev) => [...prev, ...next])
    setPreparing(false)
  }

  function removeFile(index: number) {
    setPending((prev) => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function uploadItem(item: PendingItem): Promise<PhotoInsertRow> {
    const ext = extensionFor(item.file, item.kind)
    const baseId = `${Date.now()}-${Math.random().toString(36).substring(2)}`
    const filename = `${baseId}.${ext}`

    if (item.kind === 'image') {
      const path = `${album.id}/${filename}`
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const { error } = await supabase.storage
          .from('Photos')
          .upload(path, item.file, { contentType: item.file.type || undefined })
        if (!error || isExistingObjectError(error.message)) {
          return {
            storage_path: path,
            storage_backend: 'supabase',
            url: supabase.storage.from('Photos').getPublicUrl(path).data.publicUrl,
            caption: item.caption.trim() || null,
            author_name: item.author.trim() || null,
            media_type: 'image',
            poster_path: null,
            poster_url: null,
            duration_seconds: null,
          }
        }
        if (!isRetriableStorageError(error.message) || attempt === 5) throw new Error(error.message)
        await wait(500 * attempt) // 500, 1000, 1500, 2000ms
      }
      throw new Error('Upload failed')
    }

    // Large videos use multipart chunked upload (85 MB chunks, each under Workers 100 MB limit).
    // Small videos are sent as a single Worker request.
    const res = item.file.size > MULTIPART_THRESHOLD
      ? await uploadVideoMultipart(item.file, album.id, filename)
      : await uploadToR2(item.file, album.id, filename, 'video')
    let posterPath: string | null = null
    let posterUrl: string | null = null
    let durationSeconds: number | null = null
    // 12s timeout prevents mobile browsers from hanging on poster generation
    const poster = await Promise.race([
      generateVideoPoster(item.file),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
    ])
    if (poster) {
      const posterFilename = `${baseId}.poster.jpg`
      const posterFile = new File([poster.blob], posterFilename, { type: 'image/jpeg' })
      try {
        const posterRes = await uploadToR2(posterFile, album.id, posterFilename, 'poster')
        posterPath = posterRes.storage_path
        posterUrl = posterRes.url
      } catch {
      }
      durationSeconds = poster.durationSeconds || null
    }
    return {
      storage_path: res.storage_path,
      storage_backend: 'r2',
      url: res.url,
      caption: item.caption.trim() || null,
      author_name: item.author.trim() || null,
      media_type: 'video',
      poster_path: posterPath,
      poster_url: posterUrl,
      duration_seconds: durationSeconds,
    }
  }

  async function uploadAll() {
    if (pending.length === 0) return
    const queue = [...pending]
    setUploading(true)
    setUploadError('')
    setUploadStatus(null)

    // rows is index-parallel to queue so order is preserved on save
    const rows: (PhotoInsertRow | null)[] = new Array(queue.length).fill(null)
    let completed = 0
    let cursor = 0
    // Desktop can handle more parallel uploads than mobile — coarse pointers (phone/tablet) get 3
    // so we don't saturate cell data; mouse/pen devices get 5 to make better use of the connection.
    const coarsePointer = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
    const concurrency = Math.min(coarsePointer ? 3 : 5, queue.length)

    setUploadStatus({
      fileName: `${queue.length} item${queue.length === 1 ? '' : 's'}`,
      index: 0,
      total: queue.length,
      phase: 'Uploading',
      percent: 4,
    })

    async function worker() {
      while (cursor < queue.length) {
        const myIndex = cursor
        cursor += 1
        const item = queue[myIndex]
        try {
          const row = await uploadItem(item)
          rows[myIndex] = row
        } catch (e) {
          // Leave rows[myIndex] as null — item stays in pending for retry
          console.warn('[upload] item failed:', item.file.name, e instanceof Error ? e.message : e)
        }
        completed += 1
        setUploadStatus({
          fileName: item.file.name,
          index: completed,
          total: queue.length,
          phase: completed === queue.length ? 'Saving to album' : 'Uploading',
          percent: Math.max(4, Math.round((completed / queue.length) * 90)),
        })
      }
    }

    async function runWorkers() {
      await Promise.all(Array.from({ length: concurrency }, () => worker()))
    }

    // Web Lock keeps the browser from throttling this tab while uploading.
    // Falls back gracefully when the API is unavailable.
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      await navigator.locks.request('hushare-upload', runWorkers)
    } else {
      await runWorkers()
    }

    const successRows = rows.filter((r): r is PhotoInsertRow => r !== null)
    const failedItems = queue.filter((_, i) => rows[i] === null)

    if (successRows.length > 0) {
      try {
        for (let i = 0; i < successRows.length; i += 100) {
          await saveUploadedRows(successRows.slice(i, i + 100))
        }
      } catch (e) {
        const message = `Save failed: ${e instanceof Error ? e.message : 'Could not save uploaded files'}`
        setUploadError(message)
        showAppToast(message, 'error')
        setUploading(false)
        return
      }
      onPhotoAdded()
    }

    // Revoke URLs for items that succeeded; keep failed ones alive in pending
    queue.forEach((item, i) => { if (rows[i] !== null) URL.revokeObjectURL(item.preview) })

    if (failedItems.length > 0) {
      setPending(failedItems)
      const msg = successRows.length > 0
        ? `${successRows.length} uploaded, ${failedItems.length} failed — tap Upload to retry`
        : `${failedItems.length} file${failedItems.length !== 1 ? 's' : ''} failed — tap Upload to retry`
      setUploadError(msg)
      showAppToast(msg, 'error')
    } else {
      queue.forEach((item) => URL.revokeObjectURL(item.preview))
      setPending([])
      showAppToast(`${queue.length} file${queue.length === 1 ? '' : 's'} uploaded.`)
    }

    setUploading(false)
    setUploadStatus(null)
  }

  async function saveUploadedRows(rows: PhotoInsertRow[]) {
    const res = await fetch('/api/album/photos/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album_id: album.id, photos: rows }),
    })
    const body = await res.json().catch(() => ({})) as { error?: string }
    if (!res.ok) throw new Error(body.error ?? 'Could not save uploaded files')
  }

  return (
    <div className="hush-upload-wrap my-6">
      <div
        onClick={() => { if (!uploading && !preparing) inputRef.current?.click() }}
        onDragOver={(e) => { e.preventDefault(); if (!uploading && !preparing) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files) }}
        className="hush-hover-lift hush-upload-zone rounded-2xl p-4 sm:p-8 text-center cursor-pointer transition"
        style={{
          border: dragOver ? '2px dashed #254F22' : '2px dashed #C5B9A8',
          background: dragOver ? '#E8F5E3' : '#FDFAF5',
          opacity: uploading || preparing ? 0.65 : 1,
          cursor: uploading || preparing ? 'wait' : 'pointer',
        }}
      >
        <Upload className="hush-upload-icon w-6 h-6 sm:w-8 sm:h-8 mx-auto mb-2 sm:mb-3" style={{ color: '#A89880' }} />
        <p className="hush-upload-title font-medium" style={{ color: '#254F22' }}>
          Add photos or videos
        </p>
        <p className="text-sm mt-1" style={{ color: '#7C4A2D' }}>
          Drop files here or <span style={{ textDecoration: 'underline' }}>browse</span>. No account needed.
        </p>
        <p className="hidden sm:block mt-3 text-[11px] leading-relaxed" style={{ color: '#8B6F4E' }}>
          By uploading, you agree to the{' '}
          <Link
            href="/terms"
            className="font-semibold"
            style={{ color: '#254F22' }}
            onClick={(e) => e.stopPropagation()}
          >
            Terms
          </Link>
          . Illegal or abusive content may be removed.
        </p>
        {preparing && (
          <p className="mt-3 text-xs font-semibold" style={{ color: '#254F22' }}>
            Preparing files...
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          className="hidden"
          disabled={uploading || preparing}
          onChange={(e) => {
            void addFiles(e.target.files)
            e.currentTarget.value = ''
          }}
        />
      </div>

      {pending.length > 0 && (
        <div className="mt-4 space-y-3">
          {pending.map((item, i) => (
            <div key={i} className="hush-fade-up rounded-xl p-3 flex gap-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
              <div className="relative w-16 h-16 flex-shrink-0">
                {item.kind === 'video' ? (
                  <video
                    src={item.preview}
                    className="w-16 h-16 object-cover rounded-lg"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="w-16 h-16 rounded-lg bg-center bg-cover"
                    style={{ backgroundImage: `url(${item.preview})` }}
                  />
                )}
                <span
                  className="absolute bottom-0.5 right-0.5 rounded-full px-1.5 py-0.5 flex items-center gap-0.5"
                  style={{ background: 'rgba(37,79,34,0.85)', color: '#FDFAF5', fontSize: 9 }}
                >
                  {item.kind === 'video' ? <Film className="w-2.5 h-2.5" /> : <ImageIcon className="w-2.5 h-2.5" />}
                </span>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <input
                  type="text"
                  placeholder="Caption (optional)"
                  value={item.caption}
                  disabled={uploading}
                  onChange={(e) => { const val = e.target.value; setPending((prev) => prev.map((p, idx) => idx === i ? { ...p, caption: val } : p)) }}
                  className="w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none transition disabled:opacity-60"
                  style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                  maxLength={MEDIA_CAPTION_MAX}
                />
                <input
                  type="text"
                  placeholder="Your name (optional)"
                  value={item.author}
                  disabled={uploading}
                  onChange={(e) => { const val = e.target.value; setPending((prev) => prev.map((p, idx) => idx === i ? { ...p, author: val } : p)) }}
                  className="w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none transition disabled:opacity-60"
                  style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                  maxLength={MEDIA_AUTHOR_MAX}
                />
              </div>
              <button
                onClick={() => removeFile(i)}
                disabled={uploading}
                className="flex-shrink-0 transition hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: '#C0392B' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {uploadError && (
            <div className="text-sm p-3 rounded-lg mb-2 flex items-start justify-between gap-3" style={{ background: '#FEE2E2', color: '#C0392B' }}>
              <p>{uploadError}</p>
              <button
                type="button"
                onClick={() => { setUploadError(''); setUploadStatus(null) }}
                className="font-semibold hover:underline"
                style={{ color: '#7A2A1F' }}
              >
                Dismiss
              </button>
            </div>
          )}
          {uploadStatus && (
            <div className="rounded-xl p-3" style={{ background: '#F5F0E8', border: '1px solid #DDD5C5' }}>
              <div className="flex items-center justify-between gap-3 text-xs mb-2" style={{ color: '#7C5C3E' }}>
                <span className="truncate">
                  {uploadStatus.phase} - {uploadStatus.fileName}
                </span>
                <span className="flex-none">
                  {uploadStatus.index}/{uploadStatus.total} - {uploadStatus.percent}%
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: '#E8E0D0' }}>
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${uploadStatus.percent}%`,
                    background: uploadStatus.phase.toLowerCase().includes('failed') ? '#C0392B' : '#254F22',
                  }}
                />
              </div>
            </div>
          )}
          <button
            onClick={uploadAll}
            disabled={uploading}
            className="hush-press w-full font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#254F22', color: '#FDFAF5' }}
          >
            {uploading ? 'Uploading...' : `Upload ${pending.length} item${pending.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
