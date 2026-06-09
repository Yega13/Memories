import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import HamburgerMenu from '@/components/HamburgerMenu'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById } from '@/lib/subscriptions'
import { formatDate } from '@/lib/utils'

export const runtime = 'nodejs'

type Props = {
  params: Promise<{ slug: string }>
}

type Collection = {
  id: string
  user_id: string
  name: string
  description: string | null
  slug: string
  created_at: string
}

type AlbumSummary = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  cover_photo_id: string | null
  created_at: string
}

type MediaPreview = {
  id: string
  album_id: string
  url: string
  poster_url: string | null
  stream_thumbnail_url: string | null
  media_type: 'image' | 'video'
  created_at: string
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  return {
    title: `${slug} collection`,
    robots: { index: false, follow: false },
  }
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params
  const admin = createAdminClient()
  const { data: collection } = await admin
    .from('collections')
    .select('id, user_id, name, description, slug, created_at')
    .eq('slug', slug)
    .maybeSingle<Collection>()

  if (!collection) notFound()
  const tier = await getUserTierById(collection.user_id)
  if (tier !== 'studio') notFound()

  const { data: rows } = await admin
    .from('collection_albums')
    .select('album_id, sort_order')
    .eq('collection_id', collection.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  const albumIds = (rows ?? []).map((row) => row.album_id as string)
  const { data: albums } = albumIds.length
    ? await admin
        .from('albums')
        .select('id, slug, custom_slug, title, cover_photo_id, created_at')
        .in('id', albumIds)
        .returns<AlbumSummary[]>()
    : { data: [] as AlbumSummary[] }

  const { data: mediaRows } = albumIds.length
    ? await admin
        .from('photos')
        .select('id, album_id, url, poster_url, stream_thumbnail_url, media_type, created_at')
        .in('album_id', albumIds)
        .order('created_at', { ascending: true })
        .returns<MediaPreview[]>()
    : { data: [] as MediaPreview[] }

  const orderedAlbums = albumIds
    .map((id) => {
      const album = (albums ?? []).find((candidate) => candidate.id === id)
      if (!album) return null
      const albumMedia = (mediaRows ?? []).filter((row) => row.album_id === id)
      const pinned = album.cover_photo_id ? albumMedia.find((row) => row.id === album.cover_photo_id) : undefined
      const cover = pinned ?? albumMedia.find((row) => row.media_type === 'image') ?? albumMedia[0]
      return {
        ...album,
        cover_url: cover ? (cover.media_type === 'video' ? cover.stream_thumbnail_url || cover.poster_url || null : cover.url) : null,
        media_count: albumMedia.length,
        video_count: albumMedia.filter((row) => row.media_type === 'video').length,
      }
    })
    .filter((album): album is AlbumSummary & { cover_url: string | null; media_count: number; video_count: number } => Boolean(album))

  const mediaTotal = orderedAlbums.reduce((sum, album) => sum + album.media_count, 0)
  const videoTotal = orderedAlbums.reduce((sum, album) => sum + album.video_count, 0)
  const heroCover = orderedAlbums.find((album) => album.cover_url)?.cover_url

  return (
    <main className="min-h-screen" style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}>
      <nav
        className="hush-nav sticky top-0 z-50 flex items-center justify-between"
        style={{
          background: 'rgba(253, 250, 245, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(221, 213, 197, 0.5)',
        }}
      >
        <Link href="/" className="flex items-center transition hover:opacity-70" aria-label="Hushare home">
          <Image
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            className="hush-logo"
            style={{ width: 'auto' }}
          />
        </Link>
        <HamburgerMenu>
          <Link href="/" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>
            Home
          </Link>
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>
            Pricing
          </Link>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>
            About
          </Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>
            Support
          </Link>
        </HamburgerMenu>
      </nav>

      <section className="hush-container py-8 sm:py-12">
        <div
          className="relative overflow-hidden rounded-2xl px-5 py-10 sm:px-8 sm:py-14"
          style={{ background: '#254F22', color: '#FDFAF5', boxShadow: '0 18px 56px rgba(37,79,34,0.16)' }}
        >
          {heroCover && (
            <Image
              src={heroCover}
              alt=""
              fill
              sizes="100vw"
              className="object-cover opacity-25"
              unoptimized
              priority
            />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(105deg, rgba(37,79,34,0.94), rgba(37,79,34,0.78), rgba(124,74,45,0.35))' }} />
          <div className="relative z-10 max-w-3xl">
            <p
              className="text-xs uppercase mb-3"
              style={{ color: '#F3E0BC', letterSpacing: '0.18em', fontWeight: 600 }}
            >
              Studio Collection
            </p>
            <h1
              className="text-4xl sm:text-5xl font-bold mb-4"
              style={{ fontFamily: 'var(--font-serif)', lineHeight: 1.02 }}
            >
              {collection.name}
            </h1>
            {collection.description ? (
              <p className="text-base sm:text-lg leading-relaxed max-w-2xl" style={{ color: '#FBF4E4' }}>
                {collection.description}
              </p>
            ) : (
              <p className="text-base sm:text-lg leading-relaxed max-w-2xl" style={{ color: '#FBF4E4' }}>
                A curated set of shared Hushare albums.
              </p>
            )}
          </div>
          <div className="relative z-10 mt-8 grid grid-cols-3 gap-3 max-w-xl">
            {[
              ['Albums', orderedAlbums.length],
              ['Media', mediaTotal],
              ['Videos', videoTotal],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl px-3 py-3 text-center" style={{ background: 'rgba(253,250,245,0.12)', border: '1px solid rgba(253,250,245,0.22)' }}>
                <p className="text-2xl font-bold" style={{ fontFamily: 'var(--font-serif)' }}>{value}</p>
                <p className="text-[11px] uppercase tracking-wide" style={{ color: '#F3E0BC' }}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {orderedAlbums.map((album) => {
            const href = `/${album.custom_slug ?? album.slug}`
            return (
              <Link
                key={album.id}
                href={href}
                className="hush-hover-lift overflow-hidden rounded-xl transition hover:opacity-95"
                style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 20px rgba(37,79,34,0.06)' }}
              >
                <div className="relative aspect-[4/3]" style={{ background: '#EDE7DB' }}>
                  {album.cover_url ? (
                    <Image
                      src={album.cover_url}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 30vw, (min-width: 640px) 48vw, 100vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm" style={{ color: '#8B6F4E' }}>
                      No cover yet
                    </div>
                  )}
                  <span className="absolute right-3 top-3 rounded-full px-2 py-1 text-xs font-semibold" style={{ background: 'rgba(253,250,245,0.92)', color: '#254F22' }}>
                    {album.media_count} item{album.media_count === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="p-4">
                  <h2 className="font-semibold mb-2 truncate" style={{ color: '#254F22' }}>
                    {album.title}
                  </h2>
                  <p className="text-xs" style={{ color: '#8B6F4E' }}>
                    Created {formatDate(album.created_at)}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>

        {orderedAlbums.length === 0 && (
          <div className="mt-8 rounded-2xl px-5 py-8 text-center" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
            <p className="font-semibold" style={{ color: '#254F22' }}>No albums here yet</p>
            <p className="mt-2 text-sm" style={{ color: '#8B6F4E' }}>
              The owner has not added any albums to this collection.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
