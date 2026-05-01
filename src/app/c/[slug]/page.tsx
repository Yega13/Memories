import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatDate } from '@/lib/utils'

export const runtime = 'nodejs'

type Props = {
  params: Promise<{ slug: string }>
}

type Collection = {
  id: string
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
    .select('id, name, description, slug, created_at')
    .eq('slug', slug)
    .maybeSingle<Collection>()

  if (!collection) notFound()

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
        .select('id, slug, custom_slug, title, created_at')
        .in('id', albumIds)
        .returns<AlbumSummary[]>()
    : { data: [] as AlbumSummary[] }

  const orderedAlbums = albumIds
    .map((id) => (albums ?? []).find((album) => album.id === id))
    .filter((album): album is AlbumSummary => Boolean(album))

  return (
    <main className="min-h-screen" style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}>
      <nav
        className="sticky top-0 z-50 flex items-center px-5 sm:px-8 py-4"
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
            style={{ height: '28px', width: 'auto' }}
          />
        </Link>
      </nav>

      <section className="max-w-5xl mx-auto px-5 sm:px-8 py-14">
        <p
          className="text-xs uppercase mb-3"
          style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}
        >
          Collection
        </p>
        <h1
          className="text-4xl font-bold mb-3"
          style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
        >
          {collection.name}
        </h1>
        {collection.description && (
          <p className="text-base leading-relaxed max-w-2xl" style={{ color: '#5C4A3C' }}>
            {collection.description}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
          {orderedAlbums.map((album) => {
            const href = `/${album.custom_slug ?? album.slug}`
            return (
              <Link
                key={album.id}
                href={href}
                className="rounded-xl p-5 transition hover:opacity-85"
                style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 20px rgba(37,79,34,0.06)' }}
              >
                <h2 className="font-semibold mb-2" style={{ color: '#254F22' }}>
                  {album.title}
                </h2>
                <p className="text-xs" style={{ color: '#8B6F4E' }}>
                  Created {formatDate(album.created_at)}
                </p>
              </Link>
            )
          })}
        </div>

        {orderedAlbums.length === 0 && (
          <p className="mt-10 text-sm" style={{ color: '#8B6F4E' }}>
            This collection does not have any public albums yet.
          </p>
        )}
      </section>
    </main>
  )
}
