import { Suspense } from 'react'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import AlbumPageClient from './AlbumPageClient'
import AlbumSkeleton from '@/components/AlbumSkeleton'

export const runtime = 'nodejs'

type Props = { params: Promise<{ slug: string }> }

type AlbumMeta = {
  id: string
  title: string
  cover_photo_id: string | null
  reveal_at: string | null
}

type PhotoMeta = {
  url: string
  thumb_url: string | null
  media_type: 'image' | 'video'
  poster_url: string | null
  stream_thumbnail_url: string | null
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const BRAND_OG_IMAGE = `${SITE_URL}/logo/logo-1-primary.png`

function photoOgUrl(photo: PhotoMeta): string | null {
  if (photo.media_type === 'video') {
    return photo.stream_thumbnail_url || photo.poster_url || null
  }
  // Prefer thumb_url (smaller, faster for link preview crawlers) with url as fallback.
  return photo.thumb_url || photo.url
}

async function fetchAlbumMeta(slug: string): Promise<AlbumMeta | null> {
  const admin = createAdminClient()
  // Query both slug and custom_slug in parallel.
  const [{ data: bySlug }, { data: byCustom }] = await Promise.all([
    admin.from('albums').select('id, title, cover_photo_id, reveal_at').eq('slug', slug).maybeSingle<AlbumMeta>(),
    admin.from('albums').select('id, title, cover_photo_id, reveal_at').eq('custom_slug', slug).maybeSingle<AlbumMeta>(),
  ])
  return bySlug ?? byCustom ?? null
}

async function fetchCoverUrl(album: AlbumMeta): Promise<string | null> {
  const admin = createAdminClient()

  if (album.cover_photo_id) {
    const { data: cover } = await admin
      .from('photos')
      .select('url, thumb_url, media_type, poster_url, stream_thumbnail_url')
      .eq('id', album.cover_photo_id)
      .maybeSingle<PhotoMeta>()
    if (cover) return photoOgUrl(cover)
  }

  const { data: first } = await admin
    .from('photos')
    .select('url, thumb_url, media_type, poster_url, stream_thumbnail_url')
    .eq('album_id', album.id)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<PhotoMeta>()
  return first ? photoOgUrl(first) : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const album = await fetchAlbumMeta(slug)

  if (!album) {
    return { title: 'Album', robots: { index: false, follow: false } }
  }

  const title = album.title
  const description = `View and add to "${title}" on Hushare — shared photo albums from one link.`
  const canonical = `${SITE_URL}/${slug}`

  // Don't expose the cover image before a reveal-time album unlocks.
  const isRevealed = !album.reveal_at || new Date(album.reveal_at) <= new Date()
  const coverUrl = isRevealed ? await fetchCoverUrl(album) : null
  const ogImage = coverUrl ?? BRAND_OG_IMAGE
  const hasPhoto = !!coverUrl

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: 'website',
      url: canonical,
      title,
      description,
      siteName: 'Hushare',
      images: [{ url: ogImage, alt: hasPhoto ? title : 'Hushare' }],
    },
    twitter: {
      card: hasPhoto ? 'summary_large_image' : 'summary',
      title,
      description,
      images: [ogImage],
    },
  }
}

export default function AlbumPage() {
  return (
    <Suspense fallback={<AlbumSkeleton />}>
      <AlbumPageClient />
    </Suspense>
  )
}
