'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase, supabaseUrl, supabaseAnonKey, type Album } from '@/lib/supabase'
import {
  detectKind,
  extensionFor,
  generateVideoPoster,
  DEFAULT_UPLOAD_CAPS,
  type MediaKind,
} from '@/lib/media'
import { formatFileSize } from '@/lib/utils'
import { stripExifFromJpeg } from '@/lib/exif'
import { MEDIA_AUTHOR_MAX, MEDIA_CAPTION_MAX } from '@/lib/media-text'
import { R2_SINGLE_UPLOAD_TIMEOUT_MS, R2_CHUNK_UPLOAD_TIMEOUT_MS, UPLOAD_CONCURRENCY_MOBILE, UPLOAD_CONCURRENCY_DESKTOP, R2_MULTIPART_CONCURRENCY, R2_CHUNK_SIZE_BYTES, STREAM_CHUNK_SIZE_BYTES } from '@/lib/constants'
import { showAppToast } from '@/components/AppToast'
import { Upload, X, Film, ImageIcon } from 'lucide-react'

type R2UploadResult = { storage_path: string; url: string }
type StreamUploadResult = {
  stream_uid: string
  stream_iframe_url: string
  stream_thumbnail_url: string
}

// Single XHR attempt — no retry logic here, that lives in uploadToR2.
function uploadToR2Once(
  file: File | Blob,
  albumId: string,
  filename: string,
  kind: 'video' | 'poster',
  onProgress?: (percent: number) => void,
): Promise<R2UploadResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('albumId', albumId)
  form.append('filename', filename)
  form.append('kind', kind)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload/r2')
    xhr.timeout = R2_SINGLE_UPLOAD_TIMEOUT_MS
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress?.(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      let body: { error?: string; storage_path?: string; url?: string } = {}
      try { body = JSON.parse(xhr.responseText || '{}') } catch {}
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(body.error || `R2 upload returned ${xhr.status}`))
        return
      }
      if (!body.storage_path || !body.url) {
        reject(new Error('R2 upload response was missing file details'))
        return
      }
      resolve({ storage_path: body.storage_path, url: body.url })
    }
    xhr.onerror = () => reject(new Error('Network error during R2 upload'))
    xhr.ontimeout = () => reject(new Error('R2 upload timed out'))
    xhr.send(form)
  })
}

// Retries uploadToR2Once up to 5 times with exponential backoff. Transient network
// drops (carrier proxy resets, brief Cloudflare hiccups) are the primary failure mode
// for poster uploads and small videos — a single retry loop catches them all.
async function uploadToR2(
  file: File | Blob,
  albumId: string,
  filename: string,
  kind: 'video' | 'poster',
  onProgress?: (percent: number) => void,
): Promise<R2UploadResult> {
  let lastError: Error = new Error('Upload failed')
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await uploadToR2Once(file, albumId, filename, kind, onProgress)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt < 5) await wait(Math.min(1500 * attempt, 8000))
    }
  }
  throw lastError
}

// Large video upload via R2 multipart — splits the file into chunks, each sent as raw binary
// through the Worker, which pipes req.body directly to R2 with no Worker-side buffering.
// R2 enforces a 5 MiB minimum per part. At 1 Mbps that's ~40 s per chunk — safely under
// the 60-second carrier-proxy TCP timeout. FormData was removed: it added boundary-parsing
// overhead and forced full chunk buffering in Worker heap before the R2 call.
const CHUNK_SIZE = R2_CHUNK_SIZE_BYTES

async function uploadVideoMultipart(
  file: File,
  albumId: string,
  filename: string,
  onProgress?: (percent: number) => void,
): Promise<R2UploadResult> {
  // Step 1: init
  const initRes = await fetch('/api/upload/r2/multipart?action=init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumId, filename, contentType: file.type || 'video/mp4', totalSize: file.size }),
  })
  let initBody: { error?: string; uploadId?: string; key?: string } = {}
  try { initBody = await initRes.json() } catch { /* ignore */ }
  if (!initRes.ok) throw new Error(initBody.error || `Upload init failed: ${initRes.status}`)
  const { uploadId, key } = initBody
  if (!uploadId || !key) throw new Error('Invalid upload init response')

  // Step 2: upload chunks in parallel. R2 multipart accepts out-of-order parts as long as
  // each carries the correct partNumber. Parallel workers halve upload time on fast connections
  // and match carrier throughput more effectively on mobile.
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  const partResults: Array<{ partNumber: number; etag: string } | null> = new Array(totalChunks).fill(null)
  let uploadedBytes = 0
  let chunkCursor = 0
  let abortTriggered = false

  async function uploadChunkOnce(
    partNumber: number,
    chunk: Blob,
    chunkStart: number,
    chunkEnd: number,
  ): Promise<{ partNumber: number; etag: string }> {
    // Try presigned URL first — browser PUTs directly to R2, Worker not in data path.
    // 501 = credentials not configured → fall through to Worker-proxied path silently.
    let presignedUrl: string | null = null
    try {
      const presignRes = await fetch('/api/upload/r2/multipart?action=presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, uploadId, partNumber }),
      })
      if (presignRes.ok) {
        const data = await presignRes.json() as { url?: string }
        presignedUrl = data.url ?? null
      }
      // 501 = not configured; any other non-ok status → fall through to Worker proxy
    } catch { /* network error getting presigned URL → fall through */ }

    return new Promise<{ partNumber: number; etag: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      if (presignedUrl) {
        // Direct path: browser → R2 (Worker not buffering the bytes)
        xhr.open('PUT', presignedUrl)
      } else {
        // Fallback path: browser → Worker → R2
        const params = new URLSearchParams({ action: 'chunk', uploadId: uploadId!, key: key!, partNumber: String(partNumber) })
        xhr.open('POST', `/api/upload/r2/multipart?${params.toString()}`)
      }

      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.timeout = R2_CHUNK_UPLOAD_TIMEOUT_MS
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        const chunkUploaded = (event.loaded / event.total) * (chunkEnd - chunkStart)
        onProgress?.(Math.round((uploadedBytes + chunkUploaded) / file.size * 95))
      }
      xhr.onload = () => {
        if (presignedUrl) {
          // R2 S3 API returns ETag in response header, no JSON body
          if (xhr.status >= 200 && xhr.status < 300) {
            const etag = (xhr.getResponseHeader('ETag') ?? '').replace(/"/g, '')
            if (etag) { resolve({ partNumber, etag }); return }
            reject(new Error(`No ETag for chunk ${partNumber}`))
          } else {
            reject(new Error(`Chunk ${partNumber} failed: ${xhr.status}`))
          }
        } else {
          let body: { error?: string; partNumber?: number; etag?: string } = {}
          try { body = JSON.parse(xhr.responseText || '{}') } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && body.partNumber && body.etag) {
            resolve({ partNumber: body.partNumber, etag: body.etag })
          } else {
            reject(new Error(body.error || `Chunk ${partNumber} failed: ${xhr.status}`))
          }
        }
      }
      xhr.onerror = () => reject(new Error(`Network error on chunk ${partNumber}`))
      xhr.ontimeout = () => reject(new Error(`Timeout on chunk ${partNumber}`))
      xhr.send(chunk)
    })
  }

  async function chunkWorker(): Promise<void> {
    while (!abortTriggered && chunkCursor < totalChunks) {
      const myIdx = chunkCursor++
      const chunkStart = myIdx * CHUNK_SIZE
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, file.size)
      const chunk = file.slice(chunkStart, chunkEnd)
      const partNumber = myIdx + 1

      let part: { partNumber: number; etag: string } | null = null
      let lastErr: Error | null = null
      for (let attempt = 1; attempt <= 8; attempt++) {
        if (abortTriggered) break
        try {
          part = await uploadChunkOnce(partNumber, chunk, chunkStart, chunkEnd)
          break
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e))
          if (attempt < 8) await wait(Math.min(2500 * attempt, 15000))
        }
      }

      if (!part) {
        if (!abortTriggered) {
          abortTriggered = true
          fetch('/api/upload/r2/multipart?action=abort', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId, key }),
          }).catch(() => {})
        }
        throw lastErr ?? new Error(`Chunk ${partNumber} failed`)
      }

      partResults[myIdx] = part
      uploadedBytes += chunkEnd - chunkStart
      onProgress?.(Math.round(uploadedBytes / file.size * 95))
    }
  }

  await Promise.all(Array.from({ length: Math.min(R2_MULTIPART_CONCURRENCY, totalChunks) }, () => chunkWorker()))

  const parts = partResults.filter((p): p is { partNumber: number; etag: string } => p !== null)

  // Step 3: complete
  const completeRes = await fetch('/api/upload/r2/multipart?action=complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, key, parts }),
  })
  let completeBody: { error?: string; storage_path?: string; url?: string } = {}
  try { completeBody = await completeRes.json() } catch { /* ignore */ }
  if (!completeRes.ok) {
    // Best-effort abort to avoid leaving incomplete uploads in R2
    fetch('/api/upload/r2/multipart?action=abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, key }),
    }).catch(() => {})
    throw new Error(completeBody.error || `Upload complete failed: ${completeRes.status}`)
  }
  const { storage_path, url } = completeBody
  if (!storage_path || !url) throw new Error('Invalid upload complete response')
  return { storage_path, url }
}

async function getStreamUploadOffset(uploadUrl: string): Promise<number | null> {
  try {
    const res = await fetch(uploadUrl, {
      method: 'HEAD',
      headers: { 'Tus-Resumable': '1.0.0' },
    })
    if (!res.ok) return null
    const offset = Number(res.headers.get('Upload-Offset'))
    return Number.isFinite(offset) && offset >= 0 ? offset : null
  } catch {
    return null
  }
}

async function uploadVideoToStream(
  file: File,
  albumId: string,
  filename: string,
  onProgress?: (percent: number) => void,
): Promise<StreamUploadResult> {
  const initRes = await fetch('/api/upload/stream/tus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      albumId,
      filename,
      contentType: file.type || 'video/mp4',
      totalSize: file.size,
    }),
  })
  const initBody = await initRes.json().catch(() => ({})) as {
    error?: string
    uploadUrl?: string
    stream_uid?: string
    stream_iframe_url?: string
    stream_thumbnail_url?: string
  }
  if (!initRes.ok || !initBody.uploadUrl || !initBody.stream_uid || !initBody.stream_iframe_url || !initBody.stream_thumbnail_url) {
    throw new Error(initBody.error || `Stream upload init failed: ${initRes.status}`)
  }

  // Track a definitive-failure flag separately from transient errors. A 4xx from Cloudflare
  // Stream (auth wrong, upload URL expired, request shape wrong) will keep failing no matter
  // how many times we retry, so we bail out fast and let the R2 fallback try. Only 5xx and
  // network-level errors are worth retrying.
  let offset = 0
  while (offset < file.size) {
    const start = offset
    const end = Math.min(start + STREAM_CHUNK_SIZE_BYTES, file.size)
    const chunk = file.slice(start, end)

    let lastErr: Error | null = null
    let definitiveFailure = false
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        offset = await new Promise<number>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PATCH', initBody.uploadUrl!)
          xhr.setRequestHeader('Tus-Resumable', '1.0.0')
          xhr.setRequestHeader('Upload-Offset', String(start))
          xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream')
          xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return
            const sent = start + event.loaded
            onProgress?.(Math.round(Math.min(95, (sent / file.size) * 95)))
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const nextOffset = Number(xhr.getResponseHeader('Upload-Offset') ?? end)
              resolve(Number.isFinite(nextOffset) && nextOffset > start ? nextOffset : end)
            } else {
              // Tag the error with status so the outer catch can decide whether to retry.
              const err = new Error(`Stream chunk PATCH failed: ${xhr.status} ${xhr.statusText || ''} (attempt ${attempt}, offset ${start}/${file.size}, response: ${(xhr.responseText || '').slice(0, 200)})`)
              ;(err as Error & { status?: number }).status = xhr.status
              reject(err)
            }
          }
          xhr.onerror = () => reject(new Error(`Network error during Stream upload (attempt ${attempt}, offset ${start}/${file.size})`))
          xhr.ontimeout = () => reject(new Error(`Timeout during Stream upload (attempt ${attempt}, offset ${start}/${file.size})`))
          xhr.timeout = R2_CHUNK_UPLOAD_TIMEOUT_MS
          xhr.send(chunk)
        })
        onProgress?.(Math.round(Math.min(95, (offset / file.size) * 95)))
        break
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e))
        console.warn('[stream] chunk attempt failed:', lastErr.message)
        const status = (lastErr as Error & { status?: number }).status
        // 4xx is definitive — retrying won't help. Break to R2 fallback fast.
        if (typeof status === 'number' && status >= 400 && status < 500) {
          definitiveFailure = true
          break
        }
        // Otherwise, try to recover via TUS HEAD offset and retry with capped backoff.
        const remoteOffset = await getStreamUploadOffset(initBody.uploadUrl)
        if (remoteOffset != null && remoteOffset > start) {
          offset = remoteOffset
          break
        }
        if (attempt < 5) await wait(Math.min(1500 * attempt, 6000))
      }
    }
    if (definitiveFailure) {
      throw lastErr ?? new Error('Stream upload definitively failed')
    }
    if (offset <= start) {
      throw lastErr ?? new Error('Stream upload failed')
    }
  }

  onProgress?.(98)
  return {
    stream_uid: initBody.stream_uid,
    stream_iframe_url: initBody.stream_iframe_url,
    stream_thumbnail_url: initBody.stream_thumbnail_url,
  }
}

// ─── Background poster generation ─────────────────────────────────────────────
// After a video upload + DB row insert finishes, we enqueue a background job that:
//   1) generates a poster JPEG from the local File (via lib/media.ts generateVideoPoster)
//   2) uploads the poster to R2 via the existing /api/upload/r2 route with kind='poster'
//   3) PATCHes the photo row through /api/album/photo/poster
// Jobs run strictly one at a time across the whole app (module-level state). Any failure is
// swallowed silently — uploads must never appear "failed" because of a poster.
//
// Size cap is for THUMBNAIL GENERATION only. Videos above this still upload successfully; they
// just won't get an auto-poster and the tile keeps the friendly Play placeholder. No duration
// cap, no mobile-skip — per product decision.
const POSTER_MAX_BYTES = 200 * 1024 * 1024
// Cap any single poster generation so a broken codec / hung decoder can't lock the queue.
const POSTER_GEN_TIMEOUT_MS = 60_000

type PosterJob = { file: File; albumId: string; storagePath: string }
const posterQueue: PosterJob[] = []
let posterRunning = false

async function runPosterJob(job: PosterJob): Promise<void> {
  if (job.file.size > POSTER_MAX_BYTES) return

  // Race generateVideoPoster against a timeout so a stuck decoder doesn't block subsequent jobs.
  let timeoutId: number | null = null
  let poster: Awaited<ReturnType<typeof generateVideoPoster>> = null
  try {
    poster = await Promise.race([
      generateVideoPoster(job.file),
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), POSTER_GEN_TIMEOUT_MS)
      }),
    ])
  } catch {
    return
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
  }
  if (!poster) return

  // Derive the poster filename from the video's storage_path so the poster object lives next
  // to its video in R2 (same baseId, .poster.jpg extension).
  const lastSlash = job.storagePath.lastIndexOf('/')
  const videoName = job.storagePath.slice(lastSlash + 1)
  const baseId = videoName.replace(/\.[^.]+$/, '')
  if (!baseId) return
  const posterFilename = `${baseId}.poster.jpg`

  const posterFile = new File([poster.blob], posterFilename, { type: 'image/jpeg' })
  let posterUploadResult: R2UploadResult
  try {
    posterUploadResult = await uploadToR2(posterFile, job.albumId, posterFilename, 'poster')
  } catch {
    return
  }

  try {
    await fetch('/api/album/photo/poster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        album_id: job.albumId,
        storage_path: job.storagePath,
        poster_path: posterUploadResult.storage_path,
        poster_url: posterUploadResult.url,
      }),
    })
  } catch {
    // swallow — the video itself is fine, only the auto-poster failed
  }
}

async function processPosterQueue(): Promise<void> {
  if (posterRunning) return
  posterRunning = true
  try {
    // 2 concurrent workers instead of serial — halves wait time for multi-video uploads.
    const POSTER_CONCURRENCY = 2
    async function worker() {
      while (posterQueue.length > 0) {
        const job = posterQueue.shift()
        if (!job) break
        try {
          await runPosterJob(job)
        } catch (err) {
          console.warn('[poster] job failed (silent):', job.storagePath, err)
        }
      }
    }
    await Promise.all(Array.from({ length: POSTER_CONCURRENCY }, worker))
  } finally {
    posterRunning = false
  }
}

// ─── Background R2 mirror for Stream videos ───────────────────────────────────
// When a video uploads via Cloudflare Stream, playback is fast but the original mp4 isn't
// directly downloadable. We mirror the same File to R2 in the background so the download
// feature (and any future archive workflow) keeps working. All failures are silent — Stream
// playback already works, the mirror is best-effort.

type MirrorJob = { file: File; albumId: string; storagePath: string; baseId: string }
const mirrorQueue: MirrorJob[] = []
let mirrorRunning = false

async function runMirrorJob(job: MirrorJob): Promise<void> {
  const mirrorFilename = `${job.baseId}.mp4`
  let result: R2UploadResult
  try {
    // Reuse the existing multipart path for big files so we don't have to babysit large bodies.
    // Mirror uploads are background work, so speed isn't critical — correctness/robustness is.
    result = job.file.size > MULTIPART_THRESHOLD
      ? await uploadVideoMultipart(job.file, job.albumId, mirrorFilename)
      : await uploadToR2(job.file, job.albumId, mirrorFilename, 'video')
  } catch {
    return // silent — Stream playback still works
  }
  try {
    await fetch('/api/album/photo/mirror', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        album_id: job.albumId,
        storage_path: job.storagePath,
        mirror_path: result.storage_path,
        mirror_url: result.url,
      }),
    })
  } catch {
    // swallow — silent best-effort
  }
}

async function processMirrorQueue(): Promise<void> {
  if (mirrorRunning) return
  mirrorRunning = true
  try {
    while (mirrorQueue.length > 0) {
      const job = mirrorQueue.shift()
      if (!job) break
      try {
        await runMirrorJob(job)
      } catch (err) {
        console.warn('[mirror] job failed (silent):', job.storagePath, err)
      }
    }
  } finally {
    mirrorRunning = false
  }
}

// ─── Grid thumbnail generation ────────────────────────────────────────────────
// Generates a small preview (longest side ~900 px) from the original image, encoded as WebP
// when supported and JPEG otherwise. The grid loads this thumbnail instead of the multi-MB
// original; the lightbox + download paths keep using the original `url`. If thumbnail
// generation fails at any step, we just don't include it — the upload still succeeds with
// the original, and the grid falls back to `photo.url`.

const THUMB_LONGEST_DIM = 600
const THUMB_QUALITY = 0.8
const THUMB_ENCODE_TIMEOUT_MS = 5_000

// Races blob encoding against a timeout. If encoding hangs (rare but happens on some
// browser/hardware combos), resolves null after 5 s so the upload continues without a thumbnail
// rather than stalling indefinitely. Works for both HTMLCanvasElement and OffscreenCanvas.
function toBlobWithTimeout(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob | null> {
  const encode: Promise<Blob | null> = canvas instanceof OffscreenCanvas
    ? canvas.convertToBlob({ type, quality })
    : new Promise<Blob | null>((res) => (canvas as HTMLCanvasElement).toBlob(res, type, quality))
  const timeout = new Promise<null>((res) => window.setTimeout(() => res(null), THUMB_ENCODE_TIMEOUT_MS))
  return Promise.race([encode, timeout])
}

async function generateImageThumbnail(file: File): Promise<{ blob: Blob; ext: string } | null> {
  try {
    // ImageBitmap decode is faster and runs off-thread on supported browsers.
    const bitmap = await createImageBitmap(file)
    try {
      const { width: w, height: h } = bitmap
      if (!w || !h) return null
      const longest = Math.max(w, h)
      const scale = longest > THUMB_LONGEST_DIM ? THUMB_LONGEST_DIM / longest : 1
      const tw = Math.max(1, Math.round(w * scale))
      const th = Math.max(1, Math.round(h * scale))

      // OffscreenCanvas.convertToBlob() is Promise-native and has no DOM dependency.
      // Falls back to HTMLCanvasElement for browsers without OffscreenCanvas (Safari < 16.4).
      const supportsOffscreen = typeof OffscreenCanvas !== 'undefined'
      let canvas: HTMLCanvasElement | OffscreenCanvas
      if (supportsOffscreen) {
        canvas = new OffscreenCanvas(tw, th)
      } else {
        const el = document.createElement('canvas')
        el.width = tw
        el.height = th
        canvas = el
      }
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0, tw, th)

      // Prefer WebP when the browser supports encoding it. Smaller files, identical quality.
      const webpBlob = await toBlobWithTimeout(canvas, 'image/webp', THUMB_QUALITY)
      if (webpBlob && webpBlob.type === 'image/webp') return { blob: webpBlob, ext: 'webp' }
      // Fallback: JPEG. Universally supported.
      const jpegBlob = await toBlobWithTimeout(canvas, 'image/jpeg', THUMB_QUALITY)
      if (jpegBlob) return { blob: jpegBlob, ext: 'jpg' }
      return null
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

type Props = {
  album: Album
}

type PendingItem = {
  file: File
  preview: string
  kind: MediaKind
  caption: string
  author: string
  heic?: boolean
}

type UploadStatus = {
  fileName: string
  index: number
  total: number
  phase: string
  percent: number
}

type PhotoInsertRow = {
  storage_path: string
  storage_backend: 'supabase' | 'r2' | 'stream'
  url: string
  caption: string | null
  author_name: string | null
  media_type: 'image' | 'video'
  poster_path: string | null
  poster_url: string | null
  stream_uid: string | null
  stream_iframe_url: string | null
  stream_thumbnail_url: string | null
  thumb_path: string | null
  thumb_url: string | null
  duration_seconds: number | null
}

// Files above this threshold use multipart chunked upload. Below it, the file is sent as a
// single Worker request. Match the threshold to the chunk size so a file just over the threshold
// gets split into ~2 chunks, not 1.
const MULTIPART_THRESHOLD = 5 * 1024 * 1024

const HEIC_EXT_RE = /\.(heic|heif)$/i
const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])
const FILE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,image/heif,video/*'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isRetriableStorageError(message: string): boolean {
  return /failed to fetch|load failed|network|timeout|abort|temporarily unavailable/i.test(message)
}

function isRetriableResponseStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isExistingObjectError(message: string): boolean {
  return /already exists|duplicate|resource already exists/i.test(message)
}

function isHeicFile(file: File): boolean {
  return HEIC_MIME_TYPES.has(file.type.toLowerCase()) || HEIC_EXT_RE.test(file.name)
}

function jpegNameFor(file: File): string {
  const withoutExt = file.name.replace(/\.[^.]+$/, '')
  return `${withoutExt || 'photo'}.jpg`
}

const HEIC_CONVERSION_TIMEOUT_MS = 120_000

// Singleton worker. Reused across all conversions so we don't re-pay the WASM bootstrap cost
// (heic2any pulls in ~3 MB of libheif bytes on first use).
let heicWorker: Worker | null = null
let heicWorkerBroken = false
let heicJobId = 0
const heicJobs = new Map<number, { resolve: (jpeg: Blob) => void; reject: (err: Error) => void }>()

function getHeicWorker(): Worker | null {
  if (heicWorkerBroken) return null
  if (heicWorker) return heicWorker
  try {
    // MUST be a literal RELATIVE path here. Webpack's `new Worker(new URL(...))` asset bundler
    // does not resolve TypeScript path aliases (`@/...`) — using one silently produces a broken
    // URL, the worker fails to load, and we fall back to main-thread conversion (which freezes
    // the UI). Relative path keeps the bundler happy.
    heicWorker = new Worker(new URL('../lib/heic-worker.ts', import.meta.url), { type: 'module' })
    heicWorker.addEventListener('message', (e: MessageEvent<{ id: number; jpeg?: Blob; error?: string }>) => {
      const { id, jpeg, error } = e.data
      const job = heicJobs.get(id)
      if (!job) return
      heicJobs.delete(id)
      if (jpeg) job.resolve(jpeg)
      else job.reject(new Error(error ?? 'HEIC conversion failed'))
    })
    heicWorker.addEventListener('error', (event) => {
      // Worker bootstrap failed. Log the actual reason so we can diagnose from the console
      // instead of guessing. The fallback to main-thread conversion follows.
      const reason = event.message || event.filename || 'unknown'
      console.error('[heic-worker] bootstrap/runtime error:', reason, event)
      heicWorkerBroken = true
      heicWorker = null
      heicJobs.forEach(({ reject }) => reject(new Error(`HEIC worker error: ${reason}`)))
      heicJobs.clear()
    })
    heicWorker.addEventListener('messageerror', (event) => {
      // Fires when postMessage payload couldn't be deserialized — usually a Transferable issue.
      console.error('[heic-worker] messageerror:', event)
    })
    return heicWorker
  } catch (err) {
    console.error('[heic-worker] failed to construct Worker:', err)
    heicWorkerBroken = true
    return null
  }
}

async function convertHeicViaWorker(file: File): Promise<File> {
  const worker = getHeicWorker()
  if (!worker) throw new Error('HEIC worker unavailable')
  const buffer = await file.arrayBuffer()
  const id = ++heicJobId
  let timeoutId: number | null = null
  const blob: Blob = await new Promise<Blob>((resolve, reject) => {
    heicJobs.set(id, {
      resolve: (b) => { if (timeoutId !== null) window.clearTimeout(timeoutId); resolve(b) },
      reject: (e) => { if (timeoutId !== null) window.clearTimeout(timeoutId); reject(e) },
    })
    timeoutId = window.setTimeout(() => {
      if (!heicJobs.has(id)) return
      heicJobs.delete(id)
      reject(new Error('HEIC conversion timed out'))
    }, HEIC_CONVERSION_TIMEOUT_MS)
    // Transfer the ArrayBuffer so the worker owns it (zero-copy, frees main-thread memory).
    worker.postMessage({ id, buffer }, [buffer])
  })
  return new File([blob], jpegNameFor(file), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  })
}

async function convertHeicOnMainThread(file: File): Promise<File> {
  // Fallback when the worker bootstrap fails (e.g. old browser, blocked worker source).
  // This will freeze the UI during the decode — that's the original problem, but it's
  // strictly better than refusing to convert at all.
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  const blob = Array.isArray(converted) ? converted[0] : converted
  return new File([blob], jpegNameFor(file), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  })
}

async function convertHeicToJpeg(file: File): Promise<File> {
  try {
    return await convertHeicViaWorker(file)
  } catch (err) {
    // Only fall back to main-thread if the WORKER itself is broken. Genuine conversion failures
    // (corrupt file, timeout) shouldn't trigger a freezing main-thread retry.
    if (heicWorkerBroken) return convertHeicOnMainThread(file)
    throw err
  }
}

// ─── Client-side EXIF stripping ──────────────────────────────────────────────
// Strip EXIF from JPEG files before upload so GPS, device info, and timestamps are
// never stored in Supabase. The download route also strips on the way out — this gives
// double protection. Non-JPEG images (PNG, WebP, GIF) don't use JPEG EXIF segments.
// Degrades gracefully: if stripping fails, the original file is uploaded unchanged.
async function stripExifClientSide(file: File): Promise<File> {
  if (!/^image\/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return file
  try {
    const buf = await file.arrayBuffer()
    const stripped = stripExifFromJpeg(new Uint8Array(buf))
    // Copy into a fresh ArrayBuffer so TypeScript knows the type is ArrayBuffer, not ArrayBufferLike
    const buf2 = new ArrayBuffer(stripped.byteLength)
    new Uint8Array(buf2).set(stripped)
    return new File([buf2], file.name, { type: file.type, lastModified: file.lastModified })
  } catch {
    return file
  }
}

// ─── XHR-based Supabase Storage upload ───────────────────────────────────────
// The Supabase JS SDK uses plain fetch() with no timeout. Under concurrent uploads
// (3–5 workers) a single hanging request occupies a browser connection slot
// indefinitely — when all 6 HTTP/1.1 slots to supabase.co fill up, subsequent
// requests fail immediately with "Failed to fetch" even on a solid connection.
// Replacing SDK calls with XHR gives us an explicit timeout (R2_SINGLE_UPLOAD_TIMEOUT_MS)
// and a proper error/retry surface matching the R2 upload path.

// Deduplicates concurrent getSession() calls. When 3–5 upload workers all start
// simultaneously in incognito mode (no cached session), letting each call getSession()
// independently could trigger concurrent auth-state reads on the SSR cookie client,
// potentially filling connection slots before any upload has started.
let _uploadTokenPromise: Promise<string> | null = null

function getUploadToken(): Promise<string> {
  if (!_uploadTokenPromise) {
    _uploadTokenPromise = supabase.auth.getSession()
      .then(({ data: { session } }) => session?.access_token ?? supabaseAnonKey)
      .finally(() => { _uploadTokenPromise = null })
  }
  return _uploadTokenPromise
}

function uploadToSupabaseOnce(
  file: File | Blob,
  path: string,
  token: string,
  contentType: string | undefined,
): Promise<void> {
  // Normalize URL — guard against trailing slash in the env var
  const base = supabaseUrl.replace(/\/$/, '')
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${base}/storage/v1/object/Photos/${path}`)
    xhr.timeout = R2_SINGLE_UPLOAD_TIMEOUT_MS
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    // apikey is required by Supabase's API gateway to route and identify the project.
    // The JS SDK always sends it alongside Authorization; omitting it can cause the edge
    // to drop the connection (manifesting as "Failed to fetch") rather than returning 4xx.
    xhr.setRequestHeader('apikey', supabaseAnonKey)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('cache-control', 'max-age=604800')
    if (contentType) xhr.setRequestHeader('Content-Type', contentType)
    xhr.onload = () => {
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) { resolve(); return }
      let body: { error?: string; message?: string } = {}
      try { body = JSON.parse(xhr.responseText || '{}') } catch {}
      const err = new Error(body.error || body.message || `Storage upload failed: ${xhr.status}`)
      if (xhr.status === 429) {
        const retryAfterSec = Number(xhr.getResponseHeader('Retry-After') ?? 0)
        ;(err as Error & { retryAfterMs?: number }).retryAfterMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 0
      }
      reject(err)
    }
    xhr.onerror = () => reject(new Error('Failed to fetch'))
    xhr.ontimeout = () => reject(new Error('Storage upload timed out'))
    xhr.send(file)
  })
}

async function uploadToSupabaseStorage(
  file: File | Blob,
  path: string,
  contentType: string | undefined,
): Promise<void> {
  const token = await getUploadToken()
  let lastError: Error = new Error('Upload failed')
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await uploadToSupabaseOnce(file, path, token, contentType)
      return
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      // 409 "already exists" is a success — another worker or a duplicate filename resolved it.
      if (isExistingObjectError(lastError.message)) return
      // Only retry on transient/network errors, 429, and 5xx. 4xx (auth, bad request)
      // won't be fixed by retrying — surface them immediately.
      const retriable = isRetriableStorageError(lastError.message)
        || /storage upload failed: [5]\d{2}/.test(lastError.message.toLowerCase())
        || /storage upload failed: 429/.test(lastError.message)
      if (!retriable) throw lastError
      if (attempt < 5) {
        const retryAfterMs = (lastError as Error & { retryAfterMs?: number }).retryAfterMs
        await wait(retryAfterMs && retryAfterMs > 0 ? Math.min(retryAfterMs, 30_000) : 500 * attempt)
      }
    }
  }
  throw lastError
}

export default function UploadZone({ album }: Props) {
  const [pending, setPending] = useState<PendingItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<PendingItem[]>([])

  const caps = album.upload_caps ?? DEFAULT_UPLOAD_CAPS

  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  useEffect(() => {
    if (!uploading) return
    function onVisibilityChange() {
      if (document.hidden) {
        showAppToast('Keep this tab open — upload is in progress.', 'error')
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [uploading])

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((item) => URL.revokeObjectURL(item.preview))
    }
  }, [])

  // Pre-warm the HEIC worker so the 3 MB WASM loads during component mount rather than
  // blocking the first iPhone photo conversion. No-op if the worker is already running.
  useEffect(() => { getHeicWorker() }, [])

  async function addFiles(files: FileList | null) {
    if (uploading || preparing) return
    if (!files) return
    setPreparing(true)
    const next: PendingItem[] = []
    const rejected: string[] = []

    const filesArr = Array.from(files)
    for (let idx = 0; idx < filesArr.length; idx++) {
      const file = filesArr[idx]
      const kind = detectKind(file)
      if (!kind) {
        rejected.push(`${file.name}: unsupported file type`)
        continue
      }
      const cap = kind === 'video' ? caps.video : caps.image
      if (file.size > cap) {
        rejected.push(
          `${file.name}: ${formatFileSize(file.size)} exceeds ${formatFileSize(cap)} limit`,
        )
        continue
      }

      const heic = kind === 'image' && isHeicFile(file)

      // Validate non-HEIC images by decoding a bitmap — catches corrupt/truncated files
      // before they enter the queue and stall mid-upload. HEIC is excluded because
      // createImageBitmap doesn't support it natively; the HEIC worker handles validation.
      if (kind === 'image' && !heic) {
        try {
          const bmp = await createImageBitmap(file)
          bmp.close()
        } catch {
          rejected.push(`${file.name}: unreadable image file`)
          continue
        }
      }

      next.push({
        file,
        preview: URL.createObjectURL(file),
        kind,
        caption: '',
        author: '',
        heic,
      })
    }

    if (rejected.length) {
      const message = rejected.join(' - ')
      setUploadError(message)
      showAppToast(message, 'error')
    } else {
      setUploadError('')
    }
    setPending((prev) => [...prev, ...next])
    setPreparing(false)
  }

  function removeFile(index: number) {
    setPending((prev) => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function uploadItem(item: PendingItem): Promise<PhotoInsertRow> {
    // Convert HEIC just-in-time so the prepare phase is instant for bulk iPhone uploads.
    // Conversion runs here with the existing upload concurrency (3–5 parallel) instead of
    // sequentially in addFiles, cutting perceived wait from O(n) to O(n/concurrency).
    let uploadFile = item.file
    if (item.heic) {
      try {
        uploadFile = await convertHeicToJpeg(item.file)
        const cap = item.kind === 'video' ? caps.video : caps.image
        if (uploadFile.size > cap) throw new Error(`Converted JPG is ${formatFileSize(uploadFile.size)}, above the ${formatFileSize(cap)} limit`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`${item.file.name}: HEIC conversion failed (${msg})`)
      }
    }

    // Strip EXIF from JPEG before upload — removes GPS, device info, timestamps.
    // Applied after HEIC conversion (HEIC→JPEG already produces clean JPEG from heic2any).
    if (item.kind === 'image') uploadFile = await stripExifClientSide(uploadFile)

    const ext = extensionFor(uploadFile, item.kind)
    const baseId = `${Date.now()}-${Math.random().toString(36).substring(2)}`
    const filename = `${baseId}.${ext}`

    if (item.kind === 'image') {
      const path = `${album.id}/${filename}`

      // Upload the main image and generate the thumbnail simultaneously — neither depends
      // on the other finishing first. This shaves ~200-400 ms off each image on the critical
      // path (thumbnail generation no longer blocks behind the main upload).
      const [, thumb] = await Promise.all([
        uploadToSupabaseStorage(uploadFile, path, uploadFile.type || undefined),
        generateImageThumbnail(uploadFile).catch(() => null),
      ])

      let thumbPath: string | null = null
      let thumbUrl: string | null = null
      if (thumb) {
        try {
          const tPath = `${album.id}/thumbs/${baseId}.${thumb.ext}`
          await uploadToSupabaseStorage(thumb.blob, tPath, thumb.blob.type || undefined)
          thumbPath = tPath
          thumbUrl = supabase.storage.from('Photos').getPublicUrl(tPath).data.publicUrl
        } catch {
          // silent — thumbnail is best-effort
        }
      }

      return {
        storage_path: path,
        storage_backend: 'supabase',
        url: supabase.storage.from('Photos').getPublicUrl(path).data.publicUrl,
        caption: item.caption.trim() || null,
        author_name: item.author.trim() || null,
        media_type: 'image',
        poster_path: null,
        poster_url: null,
        stream_uid: null,
        stream_iframe_url: null,
        stream_thumbnail_url: null,
        thumb_path: thumbPath,
        thumb_url: thumbUrl,
        duration_seconds: null,
      }
    }

    try {
      const stream = await uploadVideoToStream(item.file, album.id, filename)
      return {
        storage_path: `${album.id}/${stream.stream_uid}.stream`,
        storage_backend: 'stream',
        url: stream.stream_iframe_url,
        caption: item.caption.trim() || null,
        author_name: item.author.trim() || null,
        media_type: 'video',
        poster_path: null,
        poster_url: stream.stream_thumbnail_url,
        stream_uid: stream.stream_uid,
        stream_iframe_url: stream.stream_iframe_url,
        stream_thumbnail_url: stream.stream_thumbnail_url,
        thumb_path: null,
        thumb_url: null,
        duration_seconds: null,
      }
    } catch (err) {
      // Log loud + clear when Stream gives up. Without this we just see a generic "chunk 1"
      // error from the R2 fallback and have no way to diagnose what Stream actually hit.
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[stream] upload FAILED for "${item.file.name}" (${item.file.size} bytes); falling back to R2. Reason:`, msg)
    }

    const res = item.file.size > MULTIPART_THRESHOLD
      ? await uploadVideoMultipart(item.file, album.id, filename)
      : await uploadToR2(item.file, album.id, filename, 'video')
    const posterPath: string | null = null
    const posterUrl: string | null = null
    const durationSeconds: number | null = null
    return {
      storage_path: res.storage_path,
      storage_backend: 'r2',
      url: res.url,
      caption: item.caption.trim() || null,
      author_name: item.author.trim() || null,
      media_type: 'video',
      poster_path: posterPath,
      poster_url: posterUrl,
      stream_uid: null,
      stream_iframe_url: null,
      stream_thumbnail_url: null,
      thumb_path: null,
      thumb_url: null,
      duration_seconds: durationSeconds,
    }
  }

  async function uploadAll() {
    if (pending.length === 0) return
    const queue = [...pending]
    setUploading(true)
    setUploadError('')
    setUploadStatus(null)

    // rows is index-parallel to queue so order is preserved on save
    const rows: (PhotoInsertRow | null)[] = new Array(queue.length).fill(null)
    let completed = 0
    let cursor = 0
    // Device-aware concurrency. Sequential (=1) made 200-photo bulk uploads take 30+ minutes.
    // Mobile carriers don't love too many parallel uploads, so coarse pointers get 3; desktop 5.
    const coarsePointer = typeof window !== 'undefined'
      && window.matchMedia('(hover: none), (pointer: coarse)').matches
    const concurrency = Math.min(coarsePointer ? UPLOAD_CONCURRENCY_MOBILE : UPLOAD_CONCURRENCY_DESKTOP, queue.length)

    setUploadStatus({
      fileName: `${queue.length} item${queue.length === 1 ? '' : 's'}`,
      index: 0,
      total: queue.length,
      phase: 'Uploading',
      percent: 4,
    })

    // Track which preview URLs have already been revoked so we never double-revoke when the
    // end-of-batch cleanup runs. URL.revokeObjectURL is a no-op on an already-revoked URL but
    // the explicit set keeps the intent clear.
    const revokedPreviews = new Set<number>()

    const failureMessages: string[] = []
    async function worker() {
      while (cursor < queue.length) {
        const myIndex = cursor
        cursor += 1
        const item = queue[myIndex]
        // HEIC conversion runs inside uploadItem and can take 10-30s. Set the status
        // label to "Converting" before the call so the UI doesn't appear frozen.
        if (item.heic) {
          setUploadStatus({
            fileName: item.file.name,
            index: completed + 1,
            total: queue.length,
            phase: 'Converting',
            percent: Math.max(4, Math.round((completed / queue.length) * 90)),
          })
        }
        try {
          const row = await uploadItem(item)
          rows[myIndex] = row
          // Revoke the preview URL only after a successful upload. Revoking at pickup
          // was too early — failed items need their preview blob alive so the retry UI
          // can show the image. Revoking here still frees memory promptly for the
          // common success path.
          if (!revokedPreviews.has(myIndex)) {
            URL.revokeObjectURL(item.preview)
            revokedPreviews.add(myIndex)
          }
        } catch (e) {
          // Leave rows[myIndex] as null — item stays in pending for retry. Capture the message
          // so the toast surfaces the real reason (e.g. "Chunk 3 failed: ...") instead of just
          // "tap Upload to retry".
          const msg = e instanceof Error ? e.message : String(e)
          failureMessages.push(`${item.file.name}: ${msg}`)
          console.warn('[upload] item failed:', item.file.name, msg)
        }
        completed += 1
        setUploadStatus({
          fileName: item.file.name,
          index: completed,
          total: queue.length,
          phase: completed === queue.length ? 'Saving to album' : 'Uploading',
          percent: Math.max(4, Math.round((completed / queue.length) * 90)),
        })
      }
    }

    async function runWorkers() {
      await Promise.all(Array.from({ length: concurrency }, () => worker()))
    }

    // Web Lock keeps the browser from throttling this tab while uploading.
    // Falls back gracefully when the API is unavailable.
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      await navigator.locks.request('hushare-upload', runWorkers)
    } else {
      await runWorkers()
    }

    const successRows = rows.filter((r): r is PhotoInsertRow => r !== null)
    const failedItems = queue.filter((_, i) => rows[i] === null)

    let serverRejectedCount = 0
    if (successRows.length > 0) {
      try {
        for (let i = 0; i < successRows.length; i += 100) {
          const result = await saveUploadedRows(successRows.slice(i, i + 100))
          serverRejectedCount += result.rejected
        }
      } catch (e) {
        const message = `Save failed: ${e instanceof Error ? e.message : 'Could not save uploaded files'}`
        setUploadError(message)
        showAppToast(message, 'error')
        setUploading(false)
        return
      }
      // Enqueue background poster jobs for successfully uploaded videos. We DO this strictly
      // after the rows exist in the DB so the PATCH route has something to update. Jobs run
      // one at a time (module-level queue), and any failure is silent — the video itself is
      // already saved and visible to users with the friendly Play placeholder.
      queue.forEach((item, i) => {
        const row = rows[i]
        if (!row || row.media_type !== 'video') return
        if (row.storage_backend === 'stream') return
        if (item.file.size > POSTER_MAX_BYTES) return
        posterQueue.push({ file: item.file, albumId: album.id, storagePath: row.storage_path })
      })
      void processPosterQueue()

      // Enqueue background R2 mirror jobs for Stream-backed videos. Mirror = a copy of the
      // original mp4 in R2 so the download/archive button works (Stream itself doesn't expose
      // the original). All failures are silent — Stream playback still works either way.
      queue.forEach((item, i) => {
        const row = rows[i]
        if (!row || row.media_type !== 'video' || row.storage_backend !== 'stream') return
        if (!row.stream_uid) return
        mirrorQueue.push({
          file: item.file,
          albumId: album.id,
          storagePath: row.storage_path,
          baseId: row.stream_uid,
        })
      })
      void processMirrorQueue()
    }

    // Successful items' preview URLs were already revoked inside the worker. We only need to
    // sweep up any unrevoked entries here as a safety net (e.g. an item that succeeded but
    // somehow slipped past the worker's revoke). Failed items keep their preview alive on
    // purpose so they can be retried.
    queue.forEach((item, i) => {
      if (rows[i] === null) return
      if (revokedPreviews.has(i)) return
      URL.revokeObjectURL(item.preview)
      revokedPreviews.add(i)
    })

    if (failedItems.length > 0) {
      setPending(failedItems)
      // Show the first actual error inline so users have a clue why it failed, not just "retry".
      const detail = failureMessages[0] ? ` — ${failureMessages[0]}` : ''
      const msg = successRows.length > 0
        ? `${successRows.length} uploaded, ${failedItems.length} failed${detail}`
        : `${failedItems.length} file${failedItems.length !== 1 ? 's' : ''} failed${detail}`
      setUploadError(msg)
      showAppToast(msg, 'error')
    } else {
      setPending([])
      if (serverRejectedCount > 0) {
        // Uploads to storage succeeded but the server discarded some rows during validation
        // (e.g. shape mismatch). Don't requeue — those rows are storage orphans and the user
        // would just keep getting the same rejection.
        showAppToast(
          `${queue.length - serverRejectedCount} uploaded, ${serverRejectedCount} skipped by server.`,
          'error',
        )
      } else {
        showAppToast(`${queue.length} file${queue.length === 1 ? '' : 's'} uploaded.`)
      }
    }

    setUploading(false)
    setUploadStatus(null)
  }

  async function saveUploadedRows(rows: PhotoInsertRow[]): Promise<{ inserted: number; rejected: number }> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const res = await fetch('/api/album/photos/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ album_id: album.id, photos: rows }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          inserted_count?: number
          rejected_count?: number
        }

        if (res.ok) {
          return {
            inserted: typeof body.inserted_count === 'number' ? body.inserted_count : rows.length,
            rejected: typeof body.rejected_count === 'number' ? body.rejected_count : 0,
          }
        }

        lastError = new Error(body.error ?? 'Could not save uploaded files')
        if (!isRetriableResponseStatus(res.status) || attempt === 4) throw lastError
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        lastError = error
        if (!isRetriableStorageError(error.message) || attempt === 4) throw error
      }

      await wait(Math.min(700 * attempt * attempt, 5000))
    }

    throw lastError ?? new Error('Could not save uploaded files')
  }

  return (
    <div className="hush-upload-wrap my-6">
      <div
        onClick={() => { if (!uploading && !preparing) inputRef.current?.click() }}
        onDragOver={(e) => { e.preventDefault(); if (!uploading && !preparing) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files) }}
        className="hush-hover-lift hush-upload-zone rounded-2xl p-4 sm:p-8 text-center cursor-pointer transition"
        style={{
          border: dragOver ? '2px dashed #254F22' : '2px dashed #C5B9A8',
          background: dragOver ? '#E8F5E3' : '#FDFAF5',
          opacity: uploading || preparing ? 0.65 : 1,
          cursor: uploading || preparing ? 'wait' : 'pointer',
        }}
      >
        <Upload className="hush-upload-icon w-6 h-6 sm:w-8 sm:h-8 mx-auto mb-2 sm:mb-3" style={{ color: '#A89880' }} />
        <p className="hush-upload-title font-medium" style={{ color: '#254F22' }}>
          Add photos or videos
        </p>
        <p className="text-sm mt-1" style={{ color: '#7C4A2D' }}>
          Drop files here or <span style={{ textDecoration: 'underline' }}>browse</span>. No account needed.
        </p>
        <p className="hidden sm:block mt-3 text-[11px] leading-relaxed" style={{ color: '#8B6F4E' }}>
          By uploading, you agree to the{' '}
          <Link
            href="/terms"
            className="font-semibold"
            style={{ color: '#254F22' }}
            onClick={(e) => e.stopPropagation()}
          >
            Terms
          </Link>
          . Illegal or abusive content may be removed.
        </p>
        {preparing && (
          <p className="mt-3 text-xs font-semibold" style={{ color: '#254F22' }}>
            Preparing files...
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          className="hidden"
          disabled={uploading || preparing}
          onChange={(e) => {
            const input = e.currentTarget
            const files = input.files
            void addFiles(files).finally(() => {
              input.value = ''
            })
          }}
        />
      </div>

      {pending.length > 0 && (
        <div className="mt-4 space-y-3">
          {pending.map((item, i) => (
            <div key={i} className="hush-fade-up rounded-xl p-3 flex gap-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
              <div className="relative w-16 h-16 flex-shrink-0">
                {item.kind === 'video' ? (
                  <video
                    src={item.preview}
                    className="w-16 h-16 object-cover rounded-lg"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="w-16 h-16 rounded-lg bg-center bg-cover"
                    style={{ backgroundImage: `url(${item.preview})` }}
                  />
                )}
                <span
                  className="absolute bottom-0.5 right-0.5 rounded-full px-1.5 py-0.5 flex items-center gap-0.5"
                  style={{ background: 'rgba(37,79,34,0.85)', color: '#FDFAF5', fontSize: 9 }}
                >
                  {item.kind === 'video' ? <Film className="w-2.5 h-2.5" /> : <ImageIcon className="w-2.5 h-2.5" />}
                </span>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <input
                  type="text"
                  placeholder="Caption (optional)"
                  value={item.caption}
                  disabled={uploading}
                  onChange={(e) => { const val = e.target.value; setPending((prev) => prev.map((p, idx) => idx === i ? { ...p, caption: val } : p)) }}
                  className="w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none transition disabled:opacity-60"
                  style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                  maxLength={MEDIA_CAPTION_MAX}
                />
                <input
                  type="text"
                  placeholder="Your name (optional)"
                  value={item.author}
                  disabled={uploading}
                  onChange={(e) => { const val = e.target.value; setPending((prev) => prev.map((p, idx) => idx === i ? { ...p, author: val } : p)) }}
                  className="w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none transition disabled:opacity-60"
                  style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                  maxLength={MEDIA_AUTHOR_MAX}
                />
              </div>
              <button
                onClick={() => removeFile(i)}
                disabled={uploading}
                className="flex-shrink-0 transition hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: '#C0392B' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {uploadError && (
            <div className="text-sm p-3 rounded-lg mb-2 flex items-start justify-between gap-3" style={{ background: '#FEE2E2', color: '#C0392B' }}>
              <p>{uploadError}</p>
              <button
                type="button"
                onClick={() => { setUploadError(''); setUploadStatus(null) }}
                className="font-semibold hover:underline"
                style={{ color: '#7A2A1F' }}
              >
                Dismiss
              </button>
            </div>
          )}
          {uploadStatus && (
            <div className="rounded-xl p-3" style={{ background: '#F5F0E8', border: '1px solid #DDD5C5' }}>
              <div className="flex items-center justify-between gap-3 text-xs mb-2" style={{ color: '#7C5C3E' }}>
                <span className="truncate">
                  {uploadStatus.phase} - {uploadStatus.fileName}
                </span>
                <span className="flex-none">
                  {uploadStatus.index}/{uploadStatus.total} - {uploadStatus.percent}%
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: '#E8E0D0' }}>
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${uploadStatus.percent}%`,
                    background: uploadStatus.phase.toLowerCase().includes('failed') ? '#C0392B' : '#254F22',
                  }}
                />
              </div>
            </div>
          )}
          <button
            onClick={uploadAll}
            disabled={uploading}
            className="hush-press w-full font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#254F22', color: '#FDFAF5' }}
          >
            {uploading ? 'Uploading...' : `Upload ${pending.length} item${pending.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
