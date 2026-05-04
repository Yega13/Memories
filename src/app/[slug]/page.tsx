'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase, type Album, type Photo } from '@/lib/supabase'
import type { Tier } from '@/lib/subscriptions'
import UploadZone from '@/components/UploadZone'
import PhotoGrid from '@/components/PhotoGrid'
import AlbumHeader from '@/components/AlbumHeader'
import OwnerToolbar from '@/components/OwnerToolbar'
import PasswordGate from '@/components/PasswordGate'
import { resolveAlbumBackgroundImage } from '@/lib/album-backgrounds'

const DEFAULT_BG = '#FDFAF5'
const IMAGE_BG_PREFIX = 'image:'
const STOCK_BG_PREFIX = 'stock:'
const FALLBACK_MEDIA_RADIUS_MAX = 144

type AlbumUpdateOptions = {
  forceGlobalRadius?: boolean
  resetRadiusOverrides?: boolean
  resetFilterOverrides?: boolean
}

function albumBackgroundStyle(bg: string): React.CSSProperties {
  if (bg.startsWith(IMAGE_BG_PREFIX) || bg.startsWith(STOCK_BG_PREFIX)) {
    const imageUrl = resolveAlbumBackgroundImage(bg)
    return {
      backgroundColor: '#1A2B1A',
      backgroundImage: `linear-gradient(rgba(253,250,245,0.48), rgba(253,250,245,0.58)), url("${imageUrl}")`,
      backgroundAttachment: 'fixed',
      backgroundPosition: 'center',
      backgroundSize: 'cover',
    }
  }
  return { background: bg }
}

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
  const [mediaRadiusMax, setMediaRadiusMax] = useState(FALLBACK_MEDIA_RADIUS_MAX)
  const [forceGlobalRadius, setForceGlobalRadius] = useState(false)
  const [passwordGate, setPasswordGate] = useState<{ id: string; slug: string; title: string } | null>(null)

  const fetchAlbum = useCallback(async () => {
    setPasswordGate(null)
    const qs = new URLSearchParams({ slug })
    if (ownerToken) qs.set('owner_token', ownerToken)
    const res = await fetch(`/api/album/resolve?${qs.toString()}`, {
      cache: 'no-store',
    })
    type ResolveResponse = {
      album: Album | null
      password_required?: boolean
      summary?: { id: string; slug: string; title: string }
      password_protected?: boolean
    }
    const json = (await res.json().catch(() => ({}))) as ResolveResponse
    if (!res.ok && !json.password_required) {
      setNotFound(true)
      setLoading(false)
      return
    }
    if (json.password_required && json.summary) {
      setPasswordGate(json.summary)
      setLoading(false)
      return
    }

    const data = json.album
    if (!data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setAlbum(data)

    if (ownerToken) {
      try {
        const authRes = await fetch('/api/album/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: data.slug, owner_token: ownerToken }),
        })
        const result = (await authRes.json()) as { isOwner?: boolean }
        setIsOwner(!!result.isOwner)

        if (result.isOwner) {
          try {
            const tierRes = await fetch('/api/me/tier', { cache: 'no-store' })
            const tierJson = (await tierRes.json()) as { tier?: Tier }
            if (tierJson.tier) setUserTier(tierJson.tier)
          } catch {
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
      .order('sort_order', { ascending: true, nullsFirst: false })
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

  const handleAlbumUpdated = useCallback((patch: Partial<Album>, options: AlbumUpdateOptions = {}) => {
    setAlbum((prev) => (prev ? { ...prev, ...patch } : prev))
    if (patch.media_radius != null) {
      setForceGlobalRadius(!!options.forceGlobalRadius)
    }
    if (options.resetRadiusOverrides) {
      setPhotos((prev) => prev.map((photo) => ({ ...photo, display_radius: null })))
    }
    if (options.resetFilterOverrides) {
      setPhotos((prev) => prev.map((photo) => ({ ...photo, display_filter: null })))
    }
  }, [])

  const handlePhotoUpdated = useCallback((photoId: string, patch: Partial<Photo>) => {
    if ('display_radius' in patch) setForceGlobalRadius(false)
    setPhotos((prev) => prev.map((photo) => (photo.id === photoId ? { ...photo, ...patch } : photo)))
  }, [])

  const handlePhotosReordered = useCallback((nextPhotos: Photo[]) => {
    setPhotos(nextPhotos)
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={albumBackgroundStyle(DEFAULT_BG)}>
        <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid #DDD5C5', borderTopColor: '#254F22' }} />
      </div>
    )
  }

  if (passwordGate) {
    return (
      <PasswordGate
        slug={passwordGate.slug}
        title={passwordGate.title}
        onUnlocked={() => {
          setPasswordGate(null)
          setLoading(true)
          fetchAlbum()
        }}
      />
    )
  }

  if (notFound || !album) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: '#254F22', color: '#FDFAF5' }}
      >
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-serif)' }}>
          Album not found
        </h1>
        <p className="opacity-90">This link may be invalid or the album was deleted.</p>
        <Link href="/" className="underline underline-offset-4 hover:opacity-80 transition">
          Create a new album
        </Link>
      </div>
    )
  }

  const globalMediaRadiusMax = Math.max(1, mediaRadiusMax)

  return (
    <main className="hush-album-page min-h-screen" style={albumBackgroundStyle(album.background_theme ?? DEFAULT_BG)}>
      <AlbumHeader album={album} photoCount={photos.length} isOwner={isOwner} />

      {isOwner && (
        <OwnerToolbar
          album={album}
          photos={photos}
          ownerToken={ownerToken!}
          userTier={userTier}
          mediaRadiusMax={globalMediaRadiusMax}
          onAlbumUpdated={handleAlbumUpdated}
        />
      )}

      <div className="hush-container pb-12">
        <UploadZone album={album} onPhotoAdded={handlePhotoAdded} />
        <PhotoGrid
          album={album}
          photos={photos}
          isOwner={isOwner}
          slug={album.slug}
          ownerToken={ownerToken}
          forceGlobalRadius={forceGlobalRadius}
          onRadiusMaxChange={setMediaRadiusMax}
          onPhotoDeleted={handlePhotoDeleted}
          onPhotoUpdated={handlePhotoUpdated}
          onPhotosReordered={handlePhotosReordered}
        />
      </div>
    </main>
  )
}
