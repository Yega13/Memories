'use client'

import { useState, useRef } from 'react'
import { supabase, type Album } from '@/lib/supabase'
import { Upload, X } from 'lucide-react'

type Props = {
  album: Album
  onPhotoAdded: () => void
}

type PendingPhoto = {
  file: File
  preview: string
  caption: string
  author: string
}

export default function UploadZone({ album, onPhotoAdded }: Props) {
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function addFiles(files: FileList | null) {
    if (!files) return
    const newPending: PendingPhoto[] = []
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return
      newPending.push({ file, preview: URL.createObjectURL(file), caption: '', author: '' })
    })
    setPending((prev) => [...prev, ...newPending])
  }

  function removeFile(index: number) {
    setPending((prev) => prev.filter((_, i) => i !== index))
  }

  async function uploadAll() {
    if (pending.length === 0) return
    setUploading(true)
    setUploadError('')

    for (const item of pending) {
      const ext = item.file.name.split('.').pop()
      const path = `${album.id}/${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`

      const { error: storageError } = await supabase.storage
        .from('Photos')
        .upload(path, item.file, { contentType: item.file.type })

      if (storageError) {
        console.error('Storage error:', storageError)
        setUploadError(`Upload failed: ${storageError.message}`)
        setUploading(false)
        return
      }

      const { data: urlData } = supabase.storage.from('Photos').getPublicUrl(path)

      const { error: dbError } = await supabase.from('photos').insert({
        album_id: album.id,
        storage_path: path,
        url: urlData.publicUrl,
        caption: item.caption.trim() || null,
        author_name: item.author.trim() || null,
      })

      if (dbError) {
        console.error('DB error:', dbError)
        setUploadError(`Save failed: ${dbError.message}`)
        setUploading(false)
        return
      }
    }

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
          Drop photos here or <span style={{ color: '#7C4A2D', textDecoration: 'underline' }}>browse</span>
        </p>
        <p className="text-xs mt-1" style={{ color: '#A89880' }}>JPG, PNG, GIF, WebP, HEIC supported</p>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
      </div>

      {pending.length > 0 && (
        <div className="mt-4 space-y-3">
          {pending.map((item, i) => (
            <div key={i} className="rounded-xl p-3 flex gap-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
              <img src={item.preview} alt="" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
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
            {uploading ? 'Uploading...' : `Upload ${pending.length} photo${pending.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
