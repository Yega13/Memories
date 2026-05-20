import { type Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const SITE_NAME = 'Hushare'
const DEFAULT_OG_IMAGE = '/wedding.jpg'

function albumOgImageUrl(photoUrl: string): string {
  const marker = '/storage/v1/object/public/'
  const idx = photoUrl.indexOf(marker)
  if (idx === -1) return photoUrl
  return (
    photoUrl.slice(0, idx) +
    '/storage/v1/render/image/public/' +
    photoUrl.slice(idx + marker.length) +
    '?width=1200&height=630&resize=cover&quality=85'
  )
}

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params

  try {
    const admin = createAdminClient()

    const { data: album } = await admin
      .from('albums')
      .select('id, title, description, cover_photo_id, custom_slug, slug')
      .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
      .maybeSingle<{
        id: string
        title: string
        description: string | null
        cover_photo_id: string | null
        custom_slug: string | null
        slug: string
      }>()

    if (!album) return {}

    const publicSlug = album.custom_slug || album.slug
    const albumUrl = `${SITE_URL}/${publicSlug}`
    const title = album.title
    const description =
      album.description || `View and add photos to "${title}" on ${SITE_NAME}`

    let ogImageUrl = DEFAULT_OG_IMAGE

    const targetPhotoId = album.cover_photo_id

    if (targetPhotoId) {
      const { data: cover } = await admin
        .from('photos')
        .select('url, media_type')
        .eq('id', targetPhotoId)
        .eq('album_id', album.id)
        .maybeSingle<{ url: string; media_type: string }>()

      if (cover && cover.media_type !== 'video' && cover.url) {
        ogImageUrl = albumOgImageUrl(cover.url)
      }
    } else {
      const { data: first } = await admin
        .from('photos')
        .select('url, media_type')
        .eq('album_id', album.id)
        .neq('media_type', 'video')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<{ url: string; media_type: string }>()

      if (first?.url) {
        ogImageUrl = albumOgImageUrl(first.url)
      }
    }

    return {
      title,
      description,
      alternates: { canonical: albumUrl },
      openGraph: {
        type: 'website',
        url: albumUrl,
        siteName: SITE_NAME,
        title,
        description,
        images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImageUrl],
      },
    }
  } catch {
    return {}
  }
}

export default function AlbumSlugLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
