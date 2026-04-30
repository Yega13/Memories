'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { supabase, type Album, type Photo } from '@/lib/supabase'
import type { Tier } from '@/lib/subscriptions'
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
  const [userTier, setUserTier] = useState<Tier>('free')
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
    // Server-side resolver handles both random slugs and custom slugs, and
    // hides custom slugs whose owner has lapsed. Either way the response
    // shape is { album } or 404.
    const res = await fetch(`/api/album/resolve?slug=${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    })
    if (!res.ok) {
      setNotFound(true)
      setLoading(false)
      return
    }
    const { album: data } = (await res.json()) as { album: Album | null }
    if (!data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setAlbum(data)

    // Ownership is verified server-side so the owner_token never reaches
    // the browser. The endpoint returns just a boolean.
    if (ownerToken) {
      try {
        const authRes = await fetch('/api/album/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: data.slug, owner_token: ownerToken }),
        })
        const result = (await authRes.json()) as { isOwner?: boolean }
        setIsOwner(!!result.isOwner)

        // Fetch the signed-in user's tier so the owner toolbar can show
        // paid-tier UI. Anonymous owners return 'free' here.
        if (result.isOwner) {
          try {
            const tierRes = await fetch('/api/me/tier', { cache: 'no-store' })
            const tierJson = (await tierRes.json()) as { tier?: Tier }
            if (tierJson.tier) setUserTier(tierJson.tier)
          } catch {
            // Network blip — keep defaulting to 'free' so we don't show
            // gated UI by accident.
          }
        }
      } catch {
        setIsOwner(false)
      }
    }

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
          userTier={userTier}
          bgColor={bgColor}
          onBgColorChange={setBgColor}
          onAlbumUpdated={(patch) => setAlbum((prev) => (prev ? { ...prev, ...patch } : prev))}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 pb-12">
        <UploadZone album={album} onPhotoAdded={handlePhotoAdded} />
        <PhotoGrid
          photos={photos}
          isOwner={isOwner}
          slug={album.slug}
          ownerToken={ownerToken}
          onPhotoDeleted={handlePhotoDeleted}
        />
      </div>
    </main>
  )
}
