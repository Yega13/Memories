'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { supabase, type Album, type Photo } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import UploadZone from '@/components/UploadZone'
import PhotoGrid from '@/components/PhotoGrid'
import AlbumHeader from '@/components/AlbumHeader'
import OwnerToolbar from '@/components/OwnerToolbar'

const BG_KEY = 'memories-bg-color'
const DEFAULT_BG = '#FDFAF5'

export default function AlbumPage() {
  const { slug } = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const ownerToken = searchParams.get('owner')

  const [album, setAlbum] = useState<Album | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [bgColor, setBgColorState] = useState<string>(DEFAULT_BG)

  useEffect(() => {
    const saved = localStorage.getItem(BG_KEY)
    if (saved) setBgColorState(saved)
  }, [])

  function setBgColor(color: string) {
    setBgColorState(color)
    localStorage.setItem(BG_KEY, color)
  }

  const fetchAlbum = useCallback(async () => {
    const { data, error } = await supabase
      .from('albums')
      .select('*')
      .eq('slug', slug)
      .single()

    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setAlbum(data)
    setIsOwner(!!ownerToken && ownerToken === data.owner_token)
    await fetchPhotos(data.id)
    setLoading(false)
  }, [slug, ownerToken])

  const fetchPhotos = async (albumId: string) => {
    const { data } = await supabase
      .from('photos')
      .select('*')
      .eq('album_id', albumId)
      .order('created_at', { ascending: true })

    setPhotos(data || [])
  }

  useEffect(() => {
    fetchAlbum()
  }, [fetchAlbum])

  const handlePhotoAdded = () => {
    if (album) fetchPhotos(album.id)
  }

  const handlePhotoDeleted = (photoId: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId))
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: bgColor }}>
        <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid #DDD5C5', borderTopColor: '#254F22' }} />
      </div>
    )
  }

  if (notFound || !album) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: bgColor }}>
        <h1 className="text-2xl font-bold" style={{ color: '#254F22' }}>Album not found</h1>
        <p style={{ color: '#7C5C3E' }}>This link may be invalid or the album was deleted.</p>
        <a href="/" style={{ color: '#1B3A6B' }} className="hover:underline">Create a new album →</a>
      </div>
    )
  }

  return (
    <main className="min-h-screen" style={{ background: bgColor }}>
      <AlbumHeader album={album} photoCount={photos.length} isOwner={isOwner} />

      {isOwner && (
        <OwnerToolbar
          album={album}
          photos={photos}
          ownerToken={ownerToken!}
          bgColor={bgColor}
          onBgColorChange={setBgColor}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 pb-12">
        <UploadZone album={album} onPhotoAdded={handlePhotoAdded} />
        <PhotoGrid
          photos={photos}
          isOwner={isOwner}
          onPhotoDeleted={handlePhotoDeleted}
        />
      </div>
    </main>
  )
}
