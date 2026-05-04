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
const FALLBACK_MEDIA_RADIUS_MAX = 512

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

async function measureImageMax(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve(Math.max(img.naturalWidth, img.naturalHeight) || null)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function measureVideoMax(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const finish = (value: number | null) => {
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const timeout = window.setTimeout(() => finish(null), 5000)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout)
      finish(Math.max(video.videoWidth, video.videoHeight) || null)
    }
    video.onerror = () => {
      window.clearTimeout(timeout)
      finish(null)
    }
    video.src = src
  })
}

async function measurePhotoMax(photo: Photo): Promise<number> {
  const measured = photo.media_type === 'video'
    ? (await measureVideoMax(photo.url)) ?? (photo.poster_url ? await measureImageMax(photo.poster_url) : null)
    : await measureImageMax(photo.url)
  return Math.max(1, measured ?? FALLBACK_MEDIA_RADIUS_MAX)
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
  const [mediaRadiusMaxById, setMediaRadiusMaxById] = useState<Record<string, number>>({})
  // Password-gate state. When the resolver says "password_required", we
  // stash the minimal summary it returned (id + title + random slug) and
  // show <PasswordGate> instead of the album.
  const [passwordGate, setPasswordGate] = useState<{ id: string; slug: string; title: string } | null>(null)

  const fetchAlbum = useCallback(async () => {
    // Server-side resolver handles both random slugs and custom slugs, and
    // hides custom slugs whose owner has lapsed. Three possible responses:
    //   - { album, password_protected }  → render normally
    //   - { album: null, password_required, summary } → render <PasswordGate>
    //   - { album: null } 404 → not found
    setPasswordGate(null)
    // Pass owner_token along so the resolver can short-circuit the password
    // gate for the owner. Non-owners simply omit it.
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

  useEffect(() => {
    let cancelled = false
    async function measureAll() {
      const entries = await Promise.all(
        photos.map(async (photo) => [photo.id, await measurePhotoMax(photo)] as const),
      )
      if (!cancelled) setMediaRadiusMaxById(Object.fromEntries(entries))
    }
    if (photos.length > 0) void measureAll()
    else setMediaRadiusMaxById({})
    return () => {
      cancelled = true
    }
  }, [photos])

  const handlePhotoAdded = () => {
    if (album) fetchPhotos(album.id)
  }

  const handlePhotoDeleted = (photoId: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId))
  }

  const handleAlbumUpdated = (patch: Partial<Album>) => {
    setAlbum((prev) => (prev ? { ...prev, ...patch } : prev))
    if (patch.media_radius != null || patch.media_filter != null) {
      setPhotos((prev) => prev.map((photo) => ({ ...photo, display_radius: null, display_filter: null })))
    }
  }

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
    // Two-tone treatment for the 404 — deep green plate, cream type. Ignores
    // the user's chosen bgColor on purpose so the not-found state always
    // looks intentional rather than tinted by a stale localStorage value.
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
          Create a new album →
        </Link>
      </div>
    )
  }

  const globalMediaRadiusMax = Math.max(
    album.media_radius ?? 12,
    FALLBACK_MEDIA_RADIUS_MAX,
    ...Object.values(mediaRadiusMaxById),
  )

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
          mediaRadiusMaxById={mediaRadiusMaxById}
          onPhotoDeleted={handlePhotoDeleted}
          onPhotoUpdated={(photoId, patch) => setPhotos((prev) => prev.map((photo) => (photo.id === photoId ? { ...photo, ...patch } : photo)))}
        />
      </div>
    </main>
  )
}
