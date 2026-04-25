'use client'

import { type Album } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'

type Props = {
  album: Album
  photoCount: number
  isOwner: boolean
}

export default function AlbumHeader({ album, photoCount, isOwner }: Props) {
  return (
    <div style={{ borderBottom: '1px solid #DDD5C5', background: '#FDFAF5' }}>
      <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center transition hover:opacity-70" aria-label="Hushare home">
          <img
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            style={{ height: '26px', width: 'auto' }}
          />
        </Link>

        <div className="text-center flex-1 px-4">
          <h1 className="text-xl font-bold truncate" style={{ color: '#254F22' }}>{album.title}</h1>
          <p className="text-xs mt-0.5" style={{ color: '#7C5C3E' }}>
            {photoCount} photo{photoCount !== 1 ? 's' : ''} · Created {formatDate(album.created_at)}
            {isOwner && <span className="ml-2 font-semibold" style={{ color: '#1B3A6B' }}>· Owner view</span>}
          </p>
        </div>

        <div className="w-24" />
      </div>
    </div>
  )
}
