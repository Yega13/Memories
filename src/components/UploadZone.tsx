'use client'

import { useState, useRef } from 'react'
import { supabase, type Album } from '@/lib/supabase'
import {
  detectKind,
  extensionFor,
  generateVideoPoster,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  type MediaKind,
} from '@/lib/media'
import { formatFileSize } from '@/lib/utils'
import { Upload, X, Film, ImageIcon } from 'lucide-react'

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

export default function UploadZone({ album, onPhotoAdded }: Props) {
  const [pending, setPending] = useState<PendingItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function addFiles(files: FileList | null) {
    if (!files) return
    const next: PendingItem[] = []
    const rejected: string[] = []

    Array.from(files).forEach((file) => {
      const kind = detectKind(file)
      if (!kind) {
        rejected.push(`${file.name}: unsupported file type`)
        return
      }
      const cap = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
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

    if (rejected.length) setUploadError(rejected.join(' · '))
    else setUploadError('')
    setPending((prev) => [...prev, ...next])
  }

  function removeFile(index: number) {
    setPending((prev) => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function uploadAll() {
    if (pending.length === 0) return
    setUploading(true)
    setUploadError('')

    for (const item of pending) {
      const ext = extensionFor(item.file, item.kind)
      const baseId = `${Date.now()}-${Math.random().toString(36).substring(2)}`
      const path = `${album.id}/${baseId}.${ext}`

      const { error: storageError } = await supabase.storage
        .from('Photos')
        .upload(path, item.file, { contentType: item.file.type || undefined })

      if (storageError) {
        console.error('Storage error:', storageError)
        setUploadError(`Upload failed: ${storageError.message}`)
        setUploading(false)
        return
      }

      const { data: urlData } = supabase.storage.from('Photos').getPublicUrl(path)

      let posterPath: string | null = null
      let posterUrl: string | null = null
      let durationSeconds: number | null = null

      if (item.kind === 'video') {
        const poster = await generateVideoPoster(item.file)
        if (poster) {
          posterPath = `${album.id}/${baseId}.poster.jpg`
          const { error: posterError } = await supabase.storage
            .from('Photos')
            .upload(posterPath, poster.blob, { contentType: 'image/jpeg' })

          if (posterError) {
            // A missing poster is a soft failure — the video still plays,
            // it just won't have a thumbnail. Log and continue.
            console.warn('Poster upload failed:', posterError.message)
            posterPath = null
          } else {
            posterUrl = supabase.storage.from('Photos').getPublicUrl(posterPath).data.publicUrl
          }
          durationSeconds = poster.durationSeconds || null
        }
      }

      const { error: dbError } = await supabase.from('photos').insert({
        album_id: album.id,
        storage_path: path,
        url: urlData.publicUrl,
        caption: item.caption.trim() || null,
        author_name: item.author.trim() || null,
        media_type: item.kind,
        poster_path: posterPath,
        poster_url: posterUrl,
        duration_seconds: durationSeconds,
      })

      if (dbError) {
        console.error('DB error:', dbError)
        setUploadError(`Save failed: ${dbError.message}`)
        setUploading(false)
        return
      }
    }

    pending.forEach((p) => URL.revokeObjectURL(p.preview))
    setPending([])
    setUploading(false)
    onPhotoAdded()
  }

  return (
    <div className="my-6">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        className="rounded-2xl p-8 text-center cursor-pointer transition"
        style={{
          border: dragOver ? '2px dashed #254F22' : '2px dashed #C5B9A8',
          background: dragOver ? '#E8F5E3' : '#FDFAF5',
        }}
      >
        <Upload className="w-8 h-8 mx-auto mb-3" style={{ color: '#A89880' }} />
        <p className="font-medium" style={{ color: '#254F22' }}>
          Drop photos or videos here or <span style={{ color: '#7C4A2D', textDecoration: 'underline' }}>browse</span>
        </p>
        <p className="text-xs mt-1" style={{ color: '#A89880' }}>
          JPG, PNG, GIF, WebP, HEIC up to 25 MB · MP4, MOV, WebM up to 100 MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {pending.length > 0 && (
        <div className="mt-4 space-y-3">
          {pending.map((item, i) => (
            <div key={i} className="rounded-xl p-3 flex gap-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
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
                  <img src={item.preview} alt="" className="w-16 h-16 object-cover rounded-lg" />
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
                  onChange={(e) => { const val = e.target.value; setPending((prev) => prev.map((p, idx) => idx === i ? { ...p, caption: val } : p)) }}
                  className="w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none transition"
                  style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                  maxLength={100}
                />
                <input
                  type="text"
                  placeholder="Your name (optional)"
                  value={item.author}
                  onChange={(e) => { const val = e.target.value; setPending((prev) => prev.map((p, idx) => idx === i ? { ...p, author: val } : p)) }}
                  className="w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none transition"
                  style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                  maxLength={40}
                />
              </div>
              <button onClick={() => removeFile(i)} className="flex-shrink-0 transition hover:opacity-70" style={{ color: '#C0392B' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {uploadError && (
            <p className="text-sm p-3 rounded-lg mb-2" style={{ background: '#FEE2E2', color: '#C0392B' }}>
              {uploadError}
            </p>
          )}
          <button
            onClick={uploadAll}
            disabled={uploading}
            className="w-full font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#254F22', color: '#FDFAF5' }}
          >
            {uploading ? 'Uploading...' : `Upload ${pending.length} item${pending.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
