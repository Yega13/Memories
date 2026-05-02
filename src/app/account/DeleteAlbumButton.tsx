'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'

type Props = {
  albumId: string
}

export default function DeleteAlbumButton({ albumId }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function deleteAlbum() {
    if (!confirming) {
      setConfirming(true)
      setError('')
      return
    }

    setDeleting(true)
    setError('')
    try {
      const res = await fetch('/api/account/albums/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ album_id: albumId }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? `Delete failed (${res.status})`)
        return
      }
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={deleteAlbum}
        disabled={deleting}
        className="hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: confirming ? '#C0392B' : '#FFFFFF',
          border: '1px solid #C0392B',
          color: confirming ? '#FFFFFF' : '#C0392B',
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {deleting ? 'Deleting...' : confirming ? 'Confirm delete' : 'Delete'}
      </button>
      {confirming && (
        <button
          type="button"
          onClick={() => {
            setConfirming(false)
            setError('')
          }}
          className="hush-press rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
          style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
        >
          Cancel
        </button>
      )}
      {error && <span className="basis-full text-xs" style={{ color: '#C0392B' }}>{error}</span>}
    </div>
  )
}
