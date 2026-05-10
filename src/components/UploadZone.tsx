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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isRetriableStorageError(message: string): boolean {
  return /failed to fetch|network|timeout|abort/i.test(message)
}

function isExistingObjectError(message: string): boolean {
  return /already exists|duplicate|resource already exists/i.test(message)
}

export default function UploadZone({ album, onPhotoAdded }: Props) {
  const [pending, setPending] = useState<PendingItem[]>([])
  const [uploading, setUploading] = useState(false)
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
    return () => {
      pendingRef.current.forEach((item) => URL.revokeObjectURL(item.preview))
    }
  }, [])

  function addFiles(files: FileList | null) {
    if (uploading) return
    if (!files) return
    const next: PendingItem[] = []
    const rejected: string[] = []

    Array.from(files).forEach((file) => {
      const kind = detectKind(file)
      if (!kind) {
        rejected.push(`${file.name}: unsupported file type`)
        return
      }
      const cap = kind === 'video' ? caps.video : caps.image
      if (file.size > cap) {
        rejected.push(
          `${file.name}: ${formatFileSize(file.size)} exceeds ${formatFileSize(cap)} limit`,
        )
        return
      }
      next.push({
        file,
        preview: URL.createObjectURL(file),
        kind,
        caption: '',
        author: '',
      })
    })

    if (rejected.length) {
      const message = rejected.join(' - ')
      setUploadError(message)
      showAppToast(message, 'error')
    } else {
      setUploadError('')
    }
    setPending((prev) => [...prev, ...next])
  }

  function removeFile(index: number) {
    setPending((prev) => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function uploadPhoto(item: PendingItem): Promise<PhotoInsertRow> {
    const ext = extensionFor(item.file, item.kind)
    const baseId = `${Date.now()}-${Math.random().toString(36).substring(2)}`
    const filename = `${baseId}.${ext}`
    const path = `${album.id}/${filename}`

    for (let attempt = 1; attempt <= 3; attempt += 1) {
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

      if (!isRetriableStorageError(error.message) || attempt === 3) {
        throw new Error(error.message)
      }

      await wait(450 * attempt)
    }

    throw new Error('Upload failed')
  }

  async function uploadPhotoBatch(queue: PendingItem[]) {
    const rows: PhotoInsertRow[] = []
    let completed = 0
    let cursor = 0
    const concurrency = Math.min(3, queue.length)

    setUploadStatus({
      fileName: `${queue.length} photos`,
      index: 0,
      total: queue.length,
      phase: 'Uploading photos',
      percent: 8,
    })

    async function worker() {
      while (cursor < queue.length) {
        const item = queue[cursor]
        cursor += 1
        const row = await uploadPhoto(item)
        rows.push(row)
        completed += 1
        setUploadStatus({
          fileName: item.file.name,
          index: completed,
          total: queue.length,
          phase: completed === queue.length ? 'Saving to album' : 'Uploading photos',
          percent: Math.round((completed / queue.length) * 88),
        })
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))

    await saveUploadedRows(rows)

    queue.forEach((item) => URL.revokeObjectURL(item.preview))
    setPending((prev) => prev.filter((item) => !queue.includes(item)))
    setUploadStatus({
      fileName: `${queue.length} photos`,
      index: queue.length,
      total: queue.length,
      phase: 'Done',
      percent: 100,
    })
  }

  async function uploadAll() {
    if (pending.length === 0) return
    const queue = [...pending]
    setUploading(true)
    setUploadError('')
    setUploadStatus(null)

    if (queue.every((item) => item.kind === 'image')) {
      try {
        await uploadPhotoBatch(queue)
        setPending([])
        setUploading(false)
        setUploadStatus(null)
        showAppToast(`${queue.length} file${queue.length === 1 ? '' : 's'} uploaded.`)
        onPhotoAdded()
      } catch (e) {
        const message = `Upload failed: ${e instanceof Error ? e.message : 'Network error'}`
        setUploadError(message)
        showAppToast(message, 'error')
        setUploadStatus({
          fileName: `${queue.length} photos`,
          index: 0,
          total: queue.length,
          phase: 'Upload failed',
          percent: 0,
        })
        setUploading(false)
      }
      return
    }

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]
      const setCurrentStatus = (phase: string, percent: number) => {
        setUploadStatus({
          fileName: item.file.name,
          index: i + 1,
          total: queue.length,
          phase,
          percent,
        })
      }

      setCurrentStatus('Preparing', 5)
      const ext = extensionFor(item.file, item.kind)
      const baseId = `${Date.now()}-${Math.random().toString(36).substring(2)}`
      const filename = `${baseId}.${ext}`

      let storagePath: string
      let publicUrl: string
      let storageBackend: 'supabase' | 'r2'

      if (item.kind === 'video') {
        try {
          const res = await uploadToR2(item.file, album.id, filename, 'video', (percent) => {
            setCurrentStatus('Uploading video', Math.max(8, Math.min(82, Math.round(percent * 0.82))))
          })
          storagePath = res.storage_path
          publicUrl = res.url
          storageBackend = 'r2'
        } catch (e) {
          const message = `Upload failed: ${(e as Error).message}`
          setUploadError(message)
          showAppToast(message, 'error')
          setCurrentStatus('Upload failed', 0)
          setUploading(false)
          return
        }
      } else {
        setCurrentStatus('Uploading photo', 35)
        const path = `${album.id}/${filename}`
        const { error: storageError } = await supabase.storage
          .from('Photos')
          .upload(path, item.file, { contentType: item.file.type || undefined })

        if (storageError) {
          const message = `Upload failed: ${storageError.message}`
          setUploadError(message)
          showAppToast(message, 'error')
          setCurrentStatus('Upload failed', 0)
          setUploading(false)
          return
        }

        storagePath = path
        publicUrl = supabase.storage.from('Photos').getPublicUrl(path).data.publicUrl
        storageBackend = 'supabase'
        setCurrentStatus('Photo uploaded', 82)
      }

      let posterPath: string | null = null
      let posterUrl: string | null = null
      let durationSeconds: number | null = null

      if (item.kind === 'video') {
        setCurrentStatus('Creating video thumbnail', 84)
        const poster = await generateVideoPoster(item.file)
        if (poster) {
          const posterFilename = `${baseId}.poster.jpg`
          const posterFile = new File([poster.blob], posterFilename, { type: 'image/jpeg' })
          try {
            const res = await uploadToR2(posterFile, album.id, posterFilename, 'poster', (percent) => {
              setCurrentStatus('Uploading thumbnail', 84 + Math.round(percent * 0.1))
            })
            posterPath = res.storage_path
            posterUrl = res.url
          } catch {
          }
          durationSeconds = poster.durationSeconds || null
        }
      }

      setCurrentStatus('Saving to album', 95)
      const row: PhotoInsertRow = {
        storage_path: storagePath,
        storage_backend: storageBackend,
        url: publicUrl,
        caption: item.caption.trim() || null,
        author_name: item.author.trim() || null,
        media_type: item.kind,
        poster_path: posterPath,
        poster_url: posterUrl,
        duration_seconds: durationSeconds,
      }

      try {
        await saveUploadedRows([row])
      } catch (e) {
        const message = `Save failed: ${e instanceof Error ? e.message : 'Could not save uploaded file'}`
        setUploadError(message)
        showAppToast(message, 'error')
        setCurrentStatus('Save failed', 0)
        setUploading(false)
        return
      }
      setCurrentStatus('Done', 100)
      URL.revokeObjectURL(item.preview)
      setPending((prev) => prev.filter((candidate) => candidate !== item))
    }

    setPending([])
    setUploading(false)
    setUploadStatus(null)
    showAppToast(`${queue.length} file${queue.length === 1 ? '' : 's'} uploaded.`)
    onPhotoAdded()
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
        onClick={() => { if (!uploading) inputRef.current?.click() }}
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        className="hush-hover-lift hush-upload-zone rounded-2xl p-8 text-center cursor-pointer transition"
        style={{
          border: dragOver ? '2px dashed #254F22' : '2px dashed #C5B9A8',
          background: dragOver ? '#E8F5E3' : '#FDFAF5',
          opacity: uploading ? 0.65 : 1,
          cursor: uploading ? 'wait' : 'pointer',
        }}
      >
        <Upload className="hush-upload-icon w-8 h-8 mx-auto mb-3" style={{ color: '#A89880' }} />
        <p className="hush-upload-title font-medium" style={{ color: '#254F22' }}>
          Add photos or videos
        </p>
        <p className="text-sm mt-1" style={{ color: '#7C4A2D' }}>
          Drop files here or <span style={{ textDecoration: 'underline' }}>browse</span>. No account needed.
        </p>
        <p className="hush-upload-hint text-xs mt-1" style={{ color: '#A89880' }}>
          JPG, PNG, GIF, WebP, HEIC up to {formatFileSize(caps.image)} - MP4, MOV, WebM up to {formatFileSize(caps.video)}. Captions and names are optional.
        </p>
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: '#8B6F4E' }}>
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
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            addFiles(e.target.files)
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
                  maxLength={100}
                />
                <input
                  type="text"
                  placeholder="Your name (optional)"
                  value={item.author}
                  disabled={uploading}
                  onChange={(e) => { const val = e.target.value; setPending((prev) => prev.map((p, idx) => idx === i ? { ...p, author: val } : p)) }}
                  className="w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none transition disabled:opacity-60"
                  style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                  maxLength={40}
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
