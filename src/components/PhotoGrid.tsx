'use client'

import { useState } from 'react'
import { supabase, type Photo } from '@/lib/supabase'
import { Download, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react'

type Props = {
  photos: Photo[]
  isOwner: boolean
  onPhotoDeleted: (id: string) => void
}

export default function PhotoGrid({ photos, isOwner, onPhotoDeleted }: Props) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function deletePhoto(photo: Photo) {
    setDeleting(photo.id)
    await supabase.storage.from('Photos').remove([photo.storage_path])
    await supabase.from('photos').delete().eq('id', photo.id)
    onPhotoDeleted(photo.id)
    setDeleting(null)
    if (lightbox !== null) setLightbox(null)
  }

  function downloadPhoto(photo: Photo) {
    const a = document.createElement('a')
    a.href = photo.url
    a.download = photo.caption || 'photo'
    a.target = '_blank'
    a.click()
  }

  function prev() {
    if (lightbox === null) return
    setLightbox(lightbox === 0 ? photos.length - 1 : lightbox - 1)
  }

  function next() {
    if (lightbox === null) return
    setLightbox(lightbox === photos.length - 1 ? 0 : lightbox + 1)
  }

  if (photos.length === 0) {
    return (
      <div className="text-center py-20" style={{ color: '#A89880' }}>
        <p className="text-lg">No photos yet.</p>
        <p className="text-sm mt-1">Be the first to upload one!</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {photos.map((photo, index) => (
          <div
            key={photo.id}
            className="group relative aspect-square rounded-xl overflow-hidden cursor-pointer"
            style={{ background: '#EDE7DB' }}
            onClick={() => setLightbox(index)}
          >
            <img src={photo.url} alt={photo.caption || ''} className="w-full h-full object-cover transition group-hover:scale-105" />
            <div className="absolute inset-0 transition" style={{ background: 'rgba(0,0,0,0)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0)')}
            />
            {(photo.caption || photo.author_name) && (
              <div className="absolute bottom-0 left-0 right-0 p-2 translate-y-full group-hover:translate-y-0 transition"
                style={{ background: 'linear-gradient(to top, rgba(37,79,34,0.85), transparent)' }}>
                {photo.caption && <p className="text-xs font-medium truncate" style={{ color: '#FDFAF5' }}>{photo.caption}</p>}
                {photo.author_name && <p className="text-xs truncate" style={{ color: '#C5D9C2' }}>by {photo.author_name}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {lightbox !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(37,79,34,0.96)' }} onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 transition hover:opacity-70" style={{ color: '#C5D9C2' }} onClick={() => setLightbox(null)}>
            <X className="w-6 h-6" />
          </button>
          <button className="absolute left-4 transition hover:opacity-70 p-2" style={{ color: '#C5D9C2' }} onClick={(e) => { e.stopPropagation(); prev() }}>
            <ChevronLeft className="w-8 h-8" />
          </button>
          <button className="absolute right-4 transition hover:opacity-70 p-2" style={{ color: '#C5D9C2' }} onClick={(e) => { e.stopPropagation(); next() }}>
            <ChevronRight className="w-8 h-8" />
          </button>

          <div className="max-w-4xl max-h-[80vh] mx-16 flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <img src={photos[lightbox].url} alt={photos[lightbox].caption || ''} className="max-h-[70vh] max-w-full object-contain rounded-xl" />

            <div className="flex items-center gap-4">
              {(photos[lightbox].caption || photos[lightbox].author_name) && (
                <div className="text-center">
                  {photos[lightbox].caption && <p className="font-medium" style={{ color: '#FDFAF5' }}>{photos[lightbox].caption}</p>}
                  {photos[lightbox].author_name && <p className="text-sm" style={{ color: '#C5D9C2' }}>by {photos[lightbox].author_name}</p>}
                </div>
              )}
              <button onClick={() => downloadPhoto(photos[lightbox])} className="p-2 rounded-lg transition hover:opacity-80" style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }} title="Download">
                <Download className="w-5 h-5" />
              </button>
              {isOwner && (
                <button onClick={() => deletePhoto(photos[lightbox])} disabled={deleting === photos[lightbox].id} className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-50" style={{ background: 'rgba(192,57,43,0.3)', color: '#FDFAF5' }} title="Delete">
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>

            <p className="text-sm" style={{ color: '#8AB585' }}>{lightbox + 1} / {photos.length}</p>
          </div>
        </div>
      )}
    </>
  )
}
