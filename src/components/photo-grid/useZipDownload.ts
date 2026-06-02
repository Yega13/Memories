'use client'

import { useState } from 'react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { showAppToast } from '@/components/AppToast'
import type { Photo } from '@/lib/supabase'

const CONCURRENCY = 16

export function useZipDownload(photos: Photo[], albumTitle: string) {
  const [zipping, setZipping] = useState(false)
  const [zipDone, setZipDone] = useState(0)
  const [zipTotal, setZipTotal] = useState(0)

  async function downloadZip() {
    // Stream-backed videos are only downloadable once the R2 mirror is ready.
    const downloadable = photos.filter(
      (p) => p.storage_backend !== 'stream' || !!p.mirror_url,
    )
    if (downloadable.length === 0) {
      showAppToast('No downloadable files in this album yet.', 'error')
      return
    }

    setZipping(true)
    setZipDone(0)
    setZipTotal(downloadable.length)

    try {
      const zip = new JSZip()
      const usedNames = new Set<string>()

      // Build stable filenames before any network activity.
      const tasks = downloadable.map((photo) => {
        const sourceUrl = photo.storage_backend === 'stream' ? photo.mirror_url! : photo.url
        const rawExt = sourceUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
        const ext = rawExt.length <= 5 && rawExt.length > 0 ? rawExt : (photo.media_type === 'video' ? 'mp4' : 'jpg')
        const base =
          photo.caption?.trim() ||
          (photo.created_at ? new Date(photo.created_at).toISOString().slice(0, 10) : '') ||
          (photo.media_type === 'video' ? 'video' : 'photo')
        let filename = `${base}.${ext}`
        let counter = 1
        while (usedNames.has(filename)) filename = `${base}_${counter++}.${ext}`
        usedNames.add(filename)
        return { sourceUrl, filename }
      })

      async function fetchBlob(url: string): Promise<Blob> {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
        return res.blob()
      }

      let nextIdx = 0
      async function runWorker() {
        while (true) {
          const idx = nextIdx++
          if (idx >= tasks.length) break
          const { sourceUrl, filename } = tasks[idx]
          const blob = await fetchBlob(sourceUrl)
          // STORE compression — photos are already compressed, re-compressing wastes CPU.
          zip.file(filename, blob, { compression: 'STORE' })
          setZipDone((d) => d + 1)
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, runWorker))

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
      const safeTitle = (albumTitle.trim() || 'album').replace(/[/\\:*?"<>|]/g, '_')
      saveAs(zipBlob, `${safeTitle}.zip`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Download failed'
      showAppToast(msg, 'error')
    } finally {
      setZipping(false)
      setZipDone(0)
      setZipTotal(0)
    }
  }

  return { zipping, zipDone, zipTotal, downloadZip }
}
