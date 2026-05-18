'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Camera, Upload, Search, ChevronLeft } from 'lucide-react'
import type { Photo } from '@/lib/supabase'

type Props = {
  albumSlug: string
  photos: Photo[]
  onClose: () => void
}

type Step = 'indexing' | 'selfie' | 'searching' | 'results' | 'error'

type Match = { photoId: string; similarity: number }

export default function FaceFinder({ albumSlug, photos, onClose }: Props) {
  const [step, setStep] = useState<Step>('indexing')
  const [indexed, setIndexed] = useState(0)
  const [total, setTotal] = useState(0)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [lightbox, setLightbox] = useState<Photo | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const indexingDone = useRef(false)

  // Count indexable photos (images only)
  const imagePhotos = photos.filter((p) => p.media_type !== 'video')

  const runIndexing = useCallback(async () => {
    if (indexingDone.current) return
    setTotal(imagePhotos.length)

    let remaining = imagePhotos.length
    let done = 0

    while (remaining > 0) {
      try {
        const res = await fetch('/api/album/face-index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: albumSlug }),
        })
        const json = (await res.json()) as { indexed: number; remaining: number; error?: string }
        if (!res.ok) {
          setStep('error')
          setErrorMsg(json.error ?? 'Indexing failed')
          return
        }
        done += json.indexed
        remaining = json.remaining
        setIndexed(done)
      } catch {
        setStep('error')
        setErrorMsg('Network error during indexing. Please try again.')
        return
      }
    }

    indexingDone.current = true
    setStep('selfie')
  }, [albumSlug, imagePhotos.length])

  useEffect(() => {
    runIndexing()
  }, [runIndexing])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelfieFile(file)
    setSelfiePreview(URL.createObjectURL(file))
  }

  async function handleSearch() {
    if (!selfieFile) return
    setStep('searching')

    try {
      const form = new FormData()
      form.append('slug', albumSlug)
      form.append('selfie', selfieFile)

      const res = await fetch('/api/album/face-search', { method: 'POST', body: form })
      const json = (await res.json()) as { matches?: Match[]; error?: string }

      if (!res.ok) {
        setStep('error')
        setErrorMsg(json.error ?? 'Search failed')
        return
      }

      setMatches(json.matches ?? [])
      setStep('results')
    } catch {
      setStep('error')
      setErrorMsg('Network error. Please try again.')
    }
  }

  function reset() {
    setSelfieFile(null)
    setSelfiePreview(null)
    setMatches([])
    setErrorMsg('')
    setStep('selfie')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const matchedPhotos = matches
    .map((m) => ({ ...m, photo: photos.find((p) => p.id === m.photoId) }))
    .filter((m): m is { photoId: string; similarity: number; photo: Photo } => !!m.photo)

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(10,20,10,0.82)', backdropFilter: 'blur(8px)' }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        {/* Panel */}
        <div
          className="relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
          style={{ background: '#1A2B1A', maxHeight: '92dvh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
            <div className="flex items-center gap-2">
              {step === 'results' && (
                <button onClick={reset} className="hush-press p-1 rounded-full hover:opacity-70 transition" style={{ color: '#7BAF76' }}>
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              <h2 className="font-bold text-lg" style={{ fontFamily: 'var(--font-serif)', color: '#FDFAF5' }}>
                Find my photos
              </h2>
            </div>
            <button onClick={onClose} className="hush-press p-1.5 rounded-full hover:opacity-70 transition" style={{ color: '#7BAF76' }}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-5 pb-6">

            {/* INDEXING */}
            {step === 'indexing' && (
              <div className="flex flex-col items-center gap-6 py-8 text-center">
                <div className="relative w-16 h-16">
                  <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(123,175,118,0.2)" strokeWidth="6" />
                    <circle
                      cx="32" cy="32" r="28" fill="none" stroke="#7BAF76" strokeWidth="6"
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - (total > 0 ? indexed / total : 0))}`}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: '#FDFAF5' }}>
                    {total > 0 ? Math.round((indexed / total) * 100) : 0}%
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-base mb-1" style={{ color: '#FDFAF5' }}>
                    Scanning album photos
                  </p>
                  <p className="text-sm" style={{ color: '#5C7A59' }}>
                    {indexed} of {total} photos ready
                  </p>
                </div>
                <p className="text-xs max-w-xs leading-relaxed" style={{ color: '#3D5C3A' }}>
                  This runs once. Future searches are instant.
                </p>
              </div>
            )}

            {/* SELFIE */}
            {step === 'selfie' && (
              <div className="flex flex-col gap-5 py-4">
                <p className="text-sm text-center" style={{ color: '#A8C9A3' }}>
                  Take or upload a photo of yourself — we'll find every photo you appear in.
                </p>

                {selfiePreview ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      <img
                        src={selfiePreview}
                        alt="Your selfie"
                        className="w-40 h-40 rounded-2xl object-cover mx-auto"
                        style={{ border: '2px solid rgba(123,175,118,0.4)' }}
                      />
                    </div>
                    <div className="flex items-center gap-3 w-full">
                      <button
                        onClick={reset}
                        className="hush-press flex-1 py-2.5 rounded-xl text-sm font-semibold transition hover:opacity-80"
                        style={{ background: 'rgba(255,255,255,0.06)', color: '#A8C9A3', border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        Retake
                      </button>
                      <button
                        onClick={handleSearch}
                        className="hush-press flex-1 py-2.5 rounded-xl text-sm font-bold transition hover:opacity-90 flex items-center justify-center gap-2"
                        style={{ background: '#254F22', color: '#FDFAF5' }}
                      >
                        <Search className="w-4 h-4" />
                        Search
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="hush-press w-full py-10 rounded-2xl flex flex-col items-center gap-3 transition hover:opacity-80"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '2px dashed rgba(123,175,118,0.3)' }}
                    >
                      <Camera className="w-8 h-8" style={{ color: '#7BAF76' }} />
                      <span className="text-sm font-semibold" style={{ color: '#A8C9A3' }}>Take a photo or choose from library</span>
                      <span className="text-xs" style={{ color: '#3D5C3A' }}>JPG, PNG — max 5MB</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="user"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <button
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.removeAttribute('capture')
                          fileInputRef.current.click()
                        }
                      }}
                      className="hush-press w-full py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition hover:opacity-80"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#7BAF76' }}
                    >
                      <Upload className="w-4 h-4" />
                      Upload from files
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* SEARCHING */}
            {step === 'searching' && (
              <div className="flex flex-col items-center gap-5 py-10 text-center">
                <div className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#7BAF76', borderTopColor: 'transparent' }} />
                <p className="font-semibold" style={{ color: '#FDFAF5' }}>Searching for your face…</p>
              </div>
            )}

            {/* RESULTS */}
            {step === 'results' && (
              <div className="flex flex-col gap-4 py-2">
                {matchedPhotos.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="font-semibold mb-2" style={{ color: '#FDFAF5' }}>No matches found</p>
                    <p className="text-sm mb-5" style={{ color: '#5C7A59' }}>
                      Try a clearer selfie facing the camera in good lighting.
                    </p>
                    <button
                      onClick={reset}
                      className="hush-press px-5 py-2.5 rounded-xl text-sm font-semibold transition hover:opacity-90"
                      style={{ background: '#254F22', color: '#FDFAF5' }}
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm" style={{ color: '#A8C9A3' }}>
                      Found you in <strong style={{ color: '#FDFAF5' }}>{matchedPhotos.length}</strong> photo{matchedPhotos.length !== 1 ? 's' : ''}
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {matchedPhotos.map(({ photo, similarity }) => (
                        <button
                          key={photo.id}
                          onClick={() => setLightbox(photo)}
                          className="relative aspect-square rounded-xl overflow-hidden hover:opacity-90 transition"
                          style={{ border: '1px solid rgba(123,175,118,0.2)' }}
                        >
                          <img
                            src={photo.url}
                            alt={photo.caption ?? 'Photo'}
                            className="w-full h-full object-cover"
                          />
                          <div
                            className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[10px] font-semibold text-right"
                            style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.55))', color: '#FDFAF5' }}
                          >
                            {Math.round(similarity)}%
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ERROR */}
            {step === 'error' && (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <p className="font-semibold" style={{ color: '#FDFAF5' }}>Something went wrong</p>
                <p className="text-sm max-w-xs" style={{ color: '#5C7A59' }}>{errorMsg}</p>
                <button
                  onClick={() => { indexingDone.current = false; setStep('indexing'); runIndexing() }}
                  className="hush-press px-5 py-2.5 rounded-xl text-sm font-semibold transition hover:opacity-90"
                  style={{ background: '#254F22', color: '#FDFAF5' }}
                >
                  Try again
                </button>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.url}
            alt={lightbox.caption ?? 'Photo'}
            className="max-w-full max-h-full rounded-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 p-2 rounded-full hover:opacity-70 transition"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </>
  )
}
