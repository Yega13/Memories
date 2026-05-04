'use client'

import { type Album } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'

type Props = {
  album: Album
  photoCount: number
  isOwner: boolean
}

export default function AlbumHeader({ album, photoCount, isOwner }: Props) {
  return (
    <div className="hush-album-header-shell" style={{ borderBottom: '1px solid #DDD5C5', background: '#FDFAF5' }}>
      <div className="hush-container hush-album-header py-6 flex items-center justify-between">
        <Link href="/" className="hush-album-logo-link flex items-center transition hover:opacity-70" aria-label="Hushare home">
          <Image
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            className="hush-logo"
            style={{ width: 'auto' }}
          />
        </Link>

        <div className="hush-album-title-wrap text-center flex-1 px-4">
          <h1 className="hush-album-title text-xl font-bold truncate" style={{ color: '#254F22' }}>{album.title}</h1>
          <p className="hush-album-meta text-xs mt-0.5" style={{ color: '#7C5C3E' }}>
            <span>{photoCount} photo{photoCount !== 1 ? 's' : ''}</span>
            <span aria-hidden="true">-</span>
            <span>Created {formatDate(album.created_at)}</span>
            {isOwner && (
              <>
                <span className="hush-owner-dot" aria-hidden="true">-</span>
                <span className="hush-owner-pill font-semibold" style={{ color: '#1B3A6B' }}>Owner view</span>
              </>
            )}
          </p>
        </div>

        <div className="hush-album-header-spacer w-24" />
      </div>
    </div>
  )
}
