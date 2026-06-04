'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams, notFound as triggerNotFound } from 'next/navigation'
import Link from 'next/link'
import { supabase, type Album, type Photo } from '@/lib/supabase'
import type { Tier } from '@/lib/subscriptions'
import UploadZone from '@/components/UploadZone'
import PhotoGrid from '@/components/PhotoGrid'
import AlbumHeader from '@/components/AlbumHeader'
import OwnerToolbar from '@/components/OwnerToolbar'
import GuestActionsBar from '@/components/GuestActionsBar'
import PasswordGate from '@/components/PasswordGate'
import RevealCountdown from '@/components/RevealCountdown'
import FaceFinder from '@/components/FaceFinder'
import ErrorBoundary from '@/components/ErrorBoundary'
import { resolveAlbumBackgroundImage } from '@/lib/album-backgrounds'
import AlbumSkeleton from '@/components/AlbumSkeleton'

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
  const queryOwnerToken = searchParams.get('owner')

  const [album, setAlbum] = useState<Album | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [ownerToken, setOwnerToken] = useState<string | null>(queryOwnerToken)
  const [ownerTokenReady, setOwnerTokenReady] = useState(false)
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
  const ownerTokenSlugRef = useRef<string | null>(null)
  const prevGuestDownloadsRef = useRef<boolean | null>(null)
  const settingsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  // True only when this page load explicitly carried #owner= or ?owner= in the URL.
  // Cookie alone doesn't qualify — opening the guest link must show the guest view.
  const ownerTokenFromUrlRef = useRef<boolean>(!!queryOwnerToken)

  useEffect(() => {
    let cancelled = false
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    const hashOwnerToken = new URLSearchParams(hash).get('owner')
    const nextOwnerToken = hashOwnerToken || queryOwnerToken

    if (!nextOwnerToken) {
      if (ownerTokenSlugRef.current !== slug) setOwnerToken(null)
      ownerTokenSlugRef.current = slug
      setOwnerTokenReady(true)
      return () => { cancelled = true }
    }

    ownerTokenFromUrlRef.current = true
    ownerTokenSlugRef.current = slug
    setOwnerToken(nextOwnerToken)
    setOwnerTokenReady(false)

    void (async () => {
      try {
        await fetch('/api/album/owner-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, owner_token: nextOwnerToken }),
        })
      } catch {
      } finally {
        if (!cancelled) {
          window.history.replaceState(window.history.state, '', `${window.location.pathname}#owner=${encodeURIComponent(nextOwnerToken)}`)
          setOwnerTokenReady(true)
        }
      }
    })()

    return () => { cancelled = true }
  }, [slug, queryOwnerToken])

  const fetchAlbum = useCallback(async () => {
    if (!ownerTokenReady) return
    setPasswordGate(null)
    setRevealGate(null)
    setOwnerAccessDenied(false)
    const qs = new URLSearchParams({ slug })
    // owner_token is NOT sent in the URL — the browser auto-sends the HttpOnly
    // hushare_owner_* cookie set by /api/album/owner-login, which the server reads.
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

    // Run auth check and photo fetch in parallel — they are independent.
    const [authRes] = await Promise.all([
      fetch('/api/album/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: data.slug }),
      }).catch(() => null),
      fetchPhotos(data.id),
    ])

    if (authRes) {
      try {
        const result = (await authRes.json()) as { isOwner?: boolean; accessDenied?: boolean; ownerToken?: string }
        setIsOwner(!!result.isOwner)
        if (result.accessDenied) setOwnerAccessDenied(true)
        if (result.ownerToken) setOwnerToken(result.ownerToken)

        if (result.isOwner) {
          // Tier fetch is non-blocking — UI renders before it resolves.
          fetch('/api/me/tier', { cache: 'no-store' })
            .then((r) => r.json() as Promise<{ tier?: Tier }>)
            .then((j) => { if (j.tier) setUserTier(j.tier) })
            .catch(() => {})
        }
      } catch {
        setIsOwner(false)
      }
    }

    setLoading(false)
  }, [slug, ownerTokenReady])

  const fetchPhotos = async (albumId: string) => {
    const { data } = await supabase
      .from('photos')
      .select('id, album_id, storage_path, storage_backend, url, caption, author_name, created_at, media_type, poster_path, poster_url, stream_uid, stream_iframe_url, stream_thumbnail_url, mirror_path, mirror_url, thumb_path, thumb_url, duration_seconds, display_radius, display_filter, sort_order')
      .eq('album_id', albumId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(2000)

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

  // Dedicated broadcast-only channel for album settings updates.
  // Kept separate from the postgres_changes channel so the two don't interfere.
  // All visitors (owner + guests) subscribe so they all receive changes.
  useEffect(() => {
    if (!album?.id) return
    const albumId = album.id

    const ch = supabase
      .channel(`album-settings-${albumId}`)
      .on('broadcast', { event: 'album_settings' }, (payload) => {
        const data = payload.payload as { allow_guest_downloads?: boolean } | undefined
        if (data && typeof data.allow_guest_downloads === 'boolean') {
          setAlbum((prev) => prev ? { ...prev, allow_guest_downloads: data.allow_guest_downloads! } : prev)
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') settingsChannelRef.current = ch
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          settingsChannelRef.current = null
        }
      })

    return () => {
      settingsChannelRef.current = null
      void supabase.removeChannel(ch)
    }
  }, [album?.id])

  // When the owner toggles allow_guest_downloads, broadcast the new value so all connected
  // guests update their UI immediately without a page refresh.
  useEffect(() => {
    if (!album || !isOwner || !ownerTokenFromUrlRef.current) return
    if (prevGuestDownloadsRef.current === null) {
      prevGuestDownloadsRef.current = album.allow_guest_downloads
      return
    }
    if (prevGuestDownloadsRef.current === album.allow_guest_downloads) return
    prevGuestDownloadsRef.current = album.allow_guest_downloads

    const ch = settingsChannelRef.current
    if (!ch) return
    void ch.send({
      type: 'broadcast',
      event: 'album_settings',
      payload: { allow_guest_downloads: album.allow_guest_downloads },
    })
  }, [album?.allow_guest_downloads, album?.id, isOwner])

  // Realtime INSERT subscription handles new photos — no manual refetch needed here.
  // Calling fetchPhotos on each upload caused concurrent DB fetches that raced each other
  // and overwrote state, making newly-uploaded photos disappear until page refresh.
  //
  // Exception: on mobile, the Realtime WebSocket drops on cellular and INSERT events
  // are never delivered. handlePhotosUploaded fires after DB rows are saved and waits
  // 3 s to give Realtime a chance — if the count already matches, the refetch is skipped.
  const handlePhotosUploaded = useCallback(() => {
    if (!album) return
    const albumId = album.id
    // Wait 3 s to give Realtime a chance to deliver INSERT events first.
    // If it did, fetchPhotos is a no-op (state already matches DB).
    // If it didn't (common on mobile cellular), this recovers the missing photos.
    window.setTimeout(() => void fetchPhotos(albumId), 3_000)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album?.id])

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
    return <AlbumSkeleton />
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

  if (ownerAccessDenied) {
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
  // Show owner UI only when the owner token was present in the URL for this page load.
  // Cookie alone (from a previous owner session) doesn't qualify — opening the plain
  // guest link must show the guest view, even on the owner's own device.
  const effectiveIsOwner = isOwner && ownerTokenFromUrlRef.current

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
      <AlbumHeader album={album} photoCount={photos.length} isOwner={effectiveIsOwner} onAlbumUpdated={handleAlbumUpdated} />

      {effectiveIsOwner && (
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

      {!effectiveIsOwner && (
        <GuestActionsBar
          album={album}
          photos={photos}
          shareUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${album.custom_slug ?? album.slug}`}
          onOpenSlideshow={() => setSlideshowRequestId((id) => id + 1)}
          onOpenFaceFinder={() => setShowFaceFinder(true)}
        />
      )}

      <div className="hush-container pb-12">

        {showFaceFinder && (
          <ErrorBoundary>
            <FaceFinder
              albumSlug={album.custom_slug ?? album.slug}
              photos={photos}
              onClose={() => setShowFaceFinder(false)}
            />
          </ErrorBoundary>
        )}
        <UploadZone album={album} onPhotosUploaded={handlePhotosUploaded} />
        <ErrorBoundary>
        <PhotoGrid
          album={album}
          photos={photos}
          isOwner={effectiveIsOwner}
          slug={album.slug}
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

        {!effectiveIsOwner && (
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
