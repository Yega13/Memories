'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, notFound as triggerNotFound } from 'next/navigation'
import Link from 'next/link'
import { supabase, type Album, type Photo } from '@/lib/supabase'
import type { Tier } from '@/lib/subscriptions'
import UploadZone from '@/components/UploadZone'
import PhotoGrid from '@/components/PhotoGrid'
import AlbumHeader from '@/components/AlbumHeader'
import OwnerToolbar from '@/components/OwnerToolbar'
import PasswordGate from '@/components/PasswordGate'
import RevealCountdown from '@/components/RevealCountdown'
import GuestShareButton from '@/components/GuestShareButton'
import FaceFinder from '@/components/FaceFinder'
import ErrorBoundary from '@/components/ErrorBoundary'
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

function isImageBackground(bg: string): boolean {
  return bg.startsWith(IMAGE_BG_PREFIX) || bg.startsWith(STOCK_BG_PREFIX)
}

function albumBackgroundStyle(bg: string): React.CSSProperties {
  // For image/stock backgrounds we set ONLY a cream fallback colour on <main>. The actual image
  // is painted by a separate fixed-positioned layer below the content (see AlbumPageClient render
  // below). This kills two birds:
  //   1. No more dark-green flash while the bg image is loading or while mobile browsers
  //      re-rasterise during fast scroll.
  //   2. We avoid `background-attachment: fixed`, which Android Chrome and mobile Safari either
  //      drop or stutter on, producing the "screen goes green for 2-10 s" symptom.
  if (isImageBackground(bg)) {
    return { backgroundColor: DEFAULT_BG }
  }
  return { background: bg }
}

export default function AlbumPageClient() {
  const { slug } = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const ownerToken = searchParams.get('owner')

  const [album, setAlbum] = useState<Album | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [ownerAccessDenied, setOwnerAccessDenied] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [userTier, setUserTier] = useState<Tier>('free')
  const [mediaRadiusMax, setMediaRadiusMax] = useState(FALLBACK_MEDIA_RADIUS_MAX)
  const [forceGlobalRadius, setForceGlobalRadius] = useState(false)
  const [passwordGate, setPasswordGate] = useState<{ id: string; slug: string; title: string } | null>(null)
  const [slideshowRequestId, setSlideshowRequestId] = useState(0)
  const [arrangeMode, setArrangeMode] = useState(false)
  const [showFaceFinder, setShowFaceFinder] = useState(false)
  const [revealGate, setRevealGate] = useState<{ revealAt: string; summary: { id: string; slug: string; title: string } } | null>(null)

  const fetchAlbum = useCallback(async () => {
    setPasswordGate(null)
    setRevealGate(null)
    setOwnerAccessDenied(false)
    const qs = new URLSearchParams({ slug })
    if (ownerToken) qs.set('owner_token', ownerToken)
    const res = await fetch(`/api/album/resolve?${qs.toString()}`, {
      cache: 'no-store',
    })
    type ResolveResponse = {
      album: Album | null
      password_required?: boolean
      reveal_at?: string
      summary?: { id: string; slug: string; title: string }
      password_protected?: boolean
    }
    const json = (await res.json().catch(() => ({}))) as ResolveResponse
    if (!res.ok && !json.password_required && !json.reveal_at) {
      setNotFound(true)
      setLoading(false)
      return
    }
    if (json.password_required && json.summary) {
      setPasswordGate(json.summary)
      setLoading(false)
      return
    }
    if (json.reveal_at && json.summary) {
      setRevealGate({ revealAt: json.reveal_at, summary: json.summary })
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
        const result = (await authRes.json()) as { isOwner?: boolean; accessDenied?: boolean }
        setIsOwner(!!result.isOwner)
        if (result.accessDenied) setOwnerAccessDenied(true)

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

  // Real-time: new photos added by anyone appear instantly without refresh.
  // On CHANNEL_ERROR / TIMED_OUT / CLOSED, exponential-backoff reconnect fires and a
  // full photo refetch recovers any events that arrived during the gap.
  useEffect(() => {
    if (!album) return
    const albumId = album.id
    let active = true
    let retryCount = 0
    let retryTimer: number | null = null
    let currentChannel: ReturnType<typeof supabase.channel> | null = null

    function connect() {
      if (!active) return
      if (currentChannel) void supabase.removeChannel(currentChannel)

      currentChannel = supabase
        .channel(`album-photos-${albumId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'photos', filter: `album_id=eq.${albumId}` },
          (payload) => {
            const incoming = payload.new as Photo
            setPhotos((prev) => {
              if (prev.some((p) => p.id === incoming.id)) return prev
              return [...prev, incoming]
            })
          },
        )
        .on(
          'postgres_changes',
          // Server-side filter requires REPLICA IDENTITY FULL on the photos table so Postgres
          // writes album_id to WAL on DELETE. Migration: 20260529_photos_replica_identity.sql.
          { event: 'DELETE', schema: 'public', table: 'photos', filter: `album_id=eq.${albumId}` },
          (payload) => {
            const deletedId = (payload.old as { id: string }).id
            setPhotos((prev) => prev.filter((p) => p.id !== deletedId))
          },
        )
        .on(
          'postgres_changes',
          // UPDATE: keeps guests in sync when the owner changes a photo's caption, filter, radius,
          // sort_order, etc. Without this they'd see stale data until refresh.
          { event: 'UPDATE', schema: 'public', table: 'photos', filter: `album_id=eq.${albumId}` },
          (payload) => {
            const updated = payload.new as Photo
            setPhotos((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
          },
        )
        .subscribe((status, err) => {
          if (!active) return
          if (status === 'SUBSCRIBED') {
            if (retryCount > 0) {
              // Events may have been missed during the gap — resync the full photo list.
              void fetchPhotos(albumId)
            }
            retryCount = 0
            return
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (err) console.warn('[realtime] channel issue:', status, (err as Error).message)
            const delay = Math.min(2_000 * (retryCount + 1), 30_000)
            retryCount++
            retryTimer = window.setTimeout(connect, delay)
          }
        })
    }

    connect()

    return () => {
      active = false
      if (retryTimer != null) window.clearTimeout(retryTimer)
      if (currentChannel) void supabase.removeChannel(currentChannel)
    }
  // album?.id is intentional — reconnecting on every album field change would thrash the subscription
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album?.id])

  // Realtime INSERT subscription handles new photos — no manual refetch needed here.
  // Calling fetchPhotos on each upload caused concurrent DB fetches that raced each other
  // and overwrote state, making newly-uploaded photos disappear until page refresh.
  const handlePhotoAdded = () => {}

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
      <div className="min-h-screen" style={{ background: DEFAULT_BG }} />
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

  if (revealGate) {
    return (
      <RevealCountdown
        revealAt={revealGate.revealAt}
        title={revealGate.summary.title}
        onUnlocked={() => {
          setRevealGate(null)
          setLoading(true)
          fetchAlbum()
        }}
      />
    )
  }

  if (notFound || !album) {
    return triggerNotFound()
  }

  const globalMediaRadiusMax = Math.max(1, mediaRadiusMax)
  const publicSlug = album.custom_slug || album.slug
  const publicAlbumUrl = `https://hushare.space/${publicSlug}`

  const reportHref = `/report?album=${encodeURIComponent(album.title)}&url=${encodeURIComponent(publicAlbumUrl)}&slug=${encodeURIComponent(publicSlug)}`

  if (ownerAccessDenied && ownerToken) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: '#254F22', color: '#FDFAF5' }}
      >
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-serif)' }}>
          You don&apos;t have access
        </h1>
        <p className="max-w-md opacity-90">
          This management link belongs to another account. Sign in with the album owner account, or open the public album link.
        </p>
        <Link href={`/${publicSlug}`} className="underline underline-offset-4 hover:opacity-80 transition">
          Open public album
        </Link>
      </div>
    )
  }

  const rawBg = album.background_theme ?? DEFAULT_BG
  const bgImageUrl = isImageBackground(rawBg) ? resolveAlbumBackgroundImage(rawBg) : null

  return (
    <main className="hush-album-page min-h-screen relative isolate" style={albumBackgroundStyle(rawBg)}>
      {bgImageUrl && (
        <div
          aria-hidden
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: -1,
            backgroundImage: `linear-gradient(rgba(253,250,245,0.48), rgba(253,250,245,0.58)), url("${bgImageUrl}")`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
          }}
        />
      )}
      <AlbumHeader album={album} photoCount={photos.length} isOwner={isOwner} ownerToken={ownerToken} onAlbumUpdated={handleAlbumUpdated} />

      {isOwner && (
        <OwnerToolbar
          album={album}
          photos={photos}
          ownerToken={ownerToken!}
          userTier={userTier}
          mediaRadiusMax={globalMediaRadiusMax}
          onAlbumUpdated={handleAlbumUpdated}
          onOpenSlideshow={() => setSlideshowRequestId((id) => id + 1)}
          arrangeMode={arrangeMode}
          onToggleArrangeMode={() => setArrangeMode((mode) => !mode)}
        />
      )}

      <div className="hush-container pb-12">

        {!isOwner && (
          <div className="flex items-center justify-end gap-2 mb-4 mt-5">
            {album.face_finder_enabled && photos.some((p) => p.media_type !== 'video') && (
              <button
                onClick={() => setShowFaceFinder(true)}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition hover:opacity-80"
                style={{ color: '#254F22', background: 'rgba(253,250,245,0.84)', border: '1px solid #DDD5C5' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  <path d="M11 8a3 3 0 1 0 0 6"/>
                </svg>
                Find my photos
              </button>
            )}
            <GuestShareButton
              shareUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${album.custom_slug ?? album.slug}`}
              albumTitle={album.title}
            />
          </div>
        )}

        {showFaceFinder && (
          <ErrorBoundary>
            <FaceFinder
              albumSlug={album.custom_slug ?? album.slug}
              photos={photos}
              onClose={() => setShowFaceFinder(false)}
            />
          </ErrorBoundary>
        )}
        <UploadZone album={album} onPhotoAdded={handlePhotoAdded} />
        <ErrorBoundary>
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
          slideshowRequestId={slideshowRequestId}
          arrangeMode={arrangeMode}
          coverPhotoId={album.cover_photo_id}
          onCoverSet={(photoId) => handleAlbumUpdated({ cover_photo_id: photoId })}
        />
        </ErrorBoundary>

        {!isOwner && (
          <div className="mt-8 text-center">
            <Link
              href={reportHref}
              className="inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition hover:opacity-80"
              style={{ color: '#254F22', background: 'rgba(253,250,245,0.84)', border: '1px solid #DDD5C5' }}
            >
              Report this album
            </Link>
          </div>
        )}
      </div>

      {arrangeMode && (
        <button
          type="button"
          onClick={(e) => {
            const y = window.scrollY
            e.currentTarget.blur()
            setArrangeMode(false)
            requestAnimationFrame(() => {
              document.documentElement.style.scrollBehavior = 'auto'
              window.scrollTo(0, y)
              requestAnimationFrame(() => { document.documentElement.style.scrollBehavior = '' })
            })
          }}
          className="fixed bottom-6 left-6 z-40 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-lg transition active:scale-95"
          style={{ background: '#254F22', color: '#FDFAF5' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Done
        </button>
      )}
    </main>
  )
}
