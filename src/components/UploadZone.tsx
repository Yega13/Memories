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
      // Rate limit / definitive server rejection — retrying won't help, surface immediately.
      if (/upload limit reached|rate limit/i.test(lastError.message)) throw lastError
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

// Presigned URL direct-to-R2 path: if a PUT returns 403 or CORS error, the S3 credentials
// are wrong or the R2 bucket CORS policy doesn't allow the origin. Mark it broken so all
// subsequent chunks skip presign and go straight to the Worker proxy path, which uses the
// R2 binding (no S3 credentials needed) and always works. Resets per page load.
let r2PresignWorking = true

// Set to false after Stream returns 503 / "not configured" so subsequent videos in the
// same session skip the init round-trip entirely. A slow 503 response (5-10 s) × 20 videos
// / 4 workers = 25-50 s wasted just on failed Stream calls in a video-heavy batch.
let streamAvailable = true

async function uploadVideoMultipart(
  file: File,
  albumId: string,
  filename: string,
  onProgress?: (percent: number) => void,
): Promise<R2UploadResult> {
  // Reset presign status per upload. r2PresignWorking is module-level so a previous video's
  // chunk 6 failure (403 from R2 → sets flag false) would permanently route ALL subsequent
  // videos through the Worker proxy path, which times out on slow mobile (~30 s limit vs the
  // 71 s it takes to send 5 MB at 70 KB/s). Resetting here gives every video a fresh attempt
  // at the direct presigned URL path (browser → R2, no Worker in the way).
  r2PresignWorking = true

  // Step 1: init
  const initRes = await fetch('/api/upload/r2/multipart?action=init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumId, filename, contentType: file.type || 'video/mp4', totalSize: file.size }),
    signal: AbortSignal.timeout(30_000),
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
    // Skip if already known-broken (403/CORS from a previous chunk this session).
    let presignedUrl: string | null = null
    if (r2PresignWorking) {
    try {
      const presignRes = await fetch('/api/upload/r2/multipart?action=presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, uploadId, partNumber }),
        signal: AbortSignal.timeout(15_000),
      })
      if (presignRes.ok) {
        const data = await presignRes.json() as { url?: string }
        presignedUrl = data.url ?? null
      }
      // 501 = not configured; any other non-ok status → fall through to Worker proxy
    } catch { /* network error getting presigned URL → fall through */ }
    } // end if (r2PresignWorking)

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
          } else if (xhr.status === 403) {
            // Presigned URL rejected — bad S3 credentials or missing R2 CORS policy.
            // Mark broken so all subsequent chunks skip presign and use Worker proxy.
            r2PresignWorking = false
            console.warn('[r2/presign] 403 on chunk PUT — S3 credentials invalid or R2 CORS not configured. Switching to Worker proxy for all chunks.')
            reject(Object.assign(new Error(`Presigned URL rejected (403), switching to Worker proxy`), { switchToProxy: true }))
          } else {
            const err = new Error(`Chunk ${partNumber} failed: ${xhr.status}`)
            ;(err as Error & { status?: number }).status = xhr.status
            reject(err)
          }
        } else {
          let body: { error?: string; partNumber?: number; etag?: string } = {}
          try { body = JSON.parse(xhr.responseText || '{}') } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && body.partNumber && body.etag) {
            resolve({ partNumber: body.partNumber, etag: body.etag })
          } else {
            const err = new Error(body.error || `Chunk ${partNumber} failed: ${xhr.status}`)
            ;(err as Error & { status?: number }).status = xhr.status
            reject(err)
          }
        }
      }
      xhr.onerror = () => {
        if (presignedUrl) {
          // CORS error blocks reading status — treat same as 403 (broken presign credentials/policy)
          r2PresignWorking = false
          console.warn('[r2/presign] CORS error on chunk PUT — switching to Worker proxy for all chunks.')
          reject(Object.assign(new Error(`Presigned URL CORS error, switching to Worker proxy`), { switchToProxy: true }))
          return
        }
        reject(new Error(`Network error on chunk ${partNumber}`))
      }
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
      for (let attempt = 1; attempt <= maxChunkAttempts; attempt++) {
        if (abortTriggered) break
        try {
          part = await uploadChunkOnce(partNumber, chunk, chunkStart, chunkEnd)
          break
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e))
          // Presign 403/CORS → immediate free retry using Worker proxy (don't burn an attempt)
          if ((lastErr as Error & { switchToProxy?: boolean }).switchToProxy) { attempt--; continue }
          // 4xx = definitive server rejection. Retrying won't help — surface it fast.
          const httpStatus = (lastErr as Error & { status?: number }).status
          if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) break
          if (attempt < maxChunkAttempts) await wait(Math.min(2500 * attempt, maxChunkBackoffMs))
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

  // Mobile: 1 concurrent chunk worker — same burst-drop issue as file-level concurrency.
  // Two simultaneous XHRs to R2 on mobile triggers carrier reset → "Network error on chunk N".
  // Mobile also gets fewer retries (3 vs 8) and smaller max backoff (5s vs 15s): a carrier that
  // drops a 70-second 5 MB transfer will keep dropping it — retrying 8 times wastes ~67 s per
  // failed video and is the reason bulk video batches drag to 7+ minutes.
  const isMobileChunk = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
  const maxChunkAttempts = isMobileChunk ? 5 : 8
  const maxChunkBackoffMs = isMobileChunk ? 5_000 : 15_000
  const chunkConcurrency = Math.min(isMobileChunk ? 1 : R2_MULTIPART_CONCURRENCY, totalChunks)
  await Promise.all(Array.from({ length: chunkConcurrency }, () => chunkWorker()))

  const parts = partResults.filter((p): p is { partNumber: number; etag: string } => p !== null)

  // Step 3: complete
  const completeRes = await fetch('/api/upload/r2/multipart?action=complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, key, parts }),
    signal: AbortSignal.timeout(30_000),
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
  if (!streamAvailable) throw new Error('Stream not configured')

  const initRes = await fetch('/api/upload/stream/tus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      albumId,
      filename,
      contentType: file.type || 'video/mp4',
      totalSize: file.size,
    }),
    signal: AbortSignal.timeout(3_000),
  })
  const initBody = await initRes.json().catch(() => ({})) as {
    error?: string
    uploadUrl?: string
    stream_uid?: string
    stream_iframe_url?: string
    stream_thumbnail_url?: string
  }
  if (!initRes.ok || !initBody.uploadUrl || !initBody.stream_uid || !initBody.stream_iframe_url || !initBody.stream_thumbnail_url) {
    if (initRes.status === 503 || /not configured/i.test(initBody.error ?? '')) streamAvailable = false
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

// ─── Decode semaphore ─────────────────────────────────────────────────────────
// Limits concurrent image decode+encode to 1 at a time regardless of upload concurrency.
// Prevents OOM from simultaneous large bitmap allocations (e.g. two 50 MP photos decoded
// simultaneously = 400 MB). Uploads run outside the semaphore so network I/O overlaps
// with the next photo's CPU work — concurrency 2 still doubles upload throughput.
let _decodeSemaphore: Promise<void> = Promise.resolve()

function runWithDecodeSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _decodeSemaphore
  let release!: () => void
  _decodeSemaphore = new Promise(r => { release = r })
  return prev.then(() => fn()).finally(release) as Promise<T>
}

// ─── Image processing pipeline ───────────────────────────────────────────────
// Single function that handles HEIC conversion, resize, and encode in one pass.
//
// Key design decisions vs the previous implementation:
//   1. NO artificial timeout on canvas encoding. The old 5-second timeout was
//      designed for thumbnail encoding of a 600 px canvas. On mobile, encoding a
//      1920 px canvas takes 6–15 s. When the timeout fired, the function silently
//      returned the original 15–20 MB file, which the XHR then tried to upload over
//      mobile LTE. The carrier drops connections on large slow payloads → "Failed to
//      fetch". This was the root cause of 14/20 failures.
//   2. NEVER falls back to the original file. If encoding fails, the error propagates
//      so the item shows as failed rather than silently uploading a 20 MB original.
//   3. HEIC handling is inside this function — no more split logic between uploadItem
//      and separate compression code.
//   4. Single quality target for all devices: 1920 px / 0.85 quality.
//      Visually identical to the original on every screen; ~25% smaller than the
//      previous 2048 px / 0.88 setting.

// Desktop keeps 1920 px / 0.85 for full quality. Mobile drops to 1600 px / 0.80 which
// produces ~250 KB per photo vs ~400 KB — 37% smaller files means 37% faster uploads
// over a slow LTE connection without any visible quality difference on a phone screen.
const UPLOAD_MAX_DIM_DESKTOP = 1920
const UPLOAD_MAX_DIM_MOBILE  = 1600
const UPLOAD_QUALITY_DESKTOP = 0.85
const UPLOAD_QUALITY_MOBILE  = 0.80

function encodeToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return canvas instanceof OffscreenCanvas
    ? canvas.convertToBlob({ type, quality })
    : new Promise(res => (canvas as HTMLCanvasElement).toBlob(res, type, quality))
}

// Encodes an already-decoded image source to a upload-ready JPEG File.
// Shared by processImageForUpload (decode path) and addFiles (pre-compress path)
// so each image is decoded exactly once across the entire prepare → upload pipeline.
async function encodeFromSource(
  drawSource: ImageBitmap | HTMLImageElement,
  originalFile: File,
): Promise<File> {
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
  const maxDim  = isMobile ? UPLOAD_MAX_DIM_MOBILE  : UPLOAD_MAX_DIM_DESKTOP
  const quality = isMobile ? UPLOAD_QUALITY_MOBILE  : UPLOAD_QUALITY_DESKTOP

  const w = drawSource instanceof ImageBitmap ? drawSource.width : drawSource.naturalWidth
  const h = drawSource instanceof ImageBitmap ? drawSource.height : drawSource.naturalHeight
  const longest = Math.max(w, h)

  // JPEGs already within upload dimensions: skip re-encoding, just strip EXIF.
  // WebP and PNG must always be re-encoded — uploading them with a non-JPEG Content-Type
  // to Supabase causes connection resets ("Failed to fetch") on mobile.
  if (longest <= maxDim && drawSource instanceof ImageBitmap && /^image\/jpe?g$/i.test(originalFile.type)) {
    return stripExifClientSide(originalFile)
  }

  const scale = Math.min(1, maxDim / longest)
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))

  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(tw, th)
    : Object.assign(document.createElement('canvas'), { width: tw, height: th })

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('canvas context unavailable')
  ctx.drawImage(drawSource as CanvasImageSource, 0, 0, tw, th)

  const jpegBlob = await encodeToBlob(canvas, 'image/jpeg', quality)
  if (!jpegBlob) throw new Error('canvas encoding returned null blob')
  return new File([jpegBlob], originalFile.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
}

async function processImageForUpload(rawFile: File): Promise<File> {
  // Step 1 — HEIC: outside the semaphore because it uses its own WASM worker.
  let sourceFile = rawFile
  if (isHeicFile(rawFile)) {
    const nativeBitmap = await createImageBitmap(rawFile).catch(() => null)
    if (nativeBitmap) {
      nativeBitmap.close()
    } else {
      sourceFile = await convertHeicToJpeg(rawFile)
    }
  }

  // Step 2 — Decode + encode.
  // On mobile: run inside the semaphore (1 at a time) to prevent simultaneous large
  // bitmap allocations causing OOM. On desktop: run freely (4-way parallel is fine,
  // no memory pressure risk, and serialising kills throughput: 17 s → 42 s).
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches

  const decodeAndEncode = async (): Promise<File> => {
    let bitmap: ImageBitmap | null = null
    let imgElement: HTMLImageElement | null = null
    let blobUrl: string | null = null

    try {
      bitmap = await createImageBitmap(sourceFile)
    } catch {
      // Samsung Motion Photos: JPEG + embedded MP4 — extract just the JPEG portion
      if (/^image\/jpe?g$/i.test(sourceFile.type)) {
        const jpegOnly = await extractJpegBytes(sourceFile)
        if (jpegOnly !== sourceFile) {
          try {
            bitmap = await createImageBitmap(jpegOnly)
            sourceFile = new File([jpegOnly], sourceFile.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg', lastModified: sourceFile.lastModified })
          } catch { /* fall through to <img> */ }
        }
      }
      if (!bitmap) {
        blobUrl = URL.createObjectURL(sourceFile)
        imgElement = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image()
          const timer = window.setTimeout(() => reject(new Error('cannot decode image')), 15_000)
          el.onload = () => { window.clearTimeout(timer); resolve(el) }
          el.onerror = () => { window.clearTimeout(timer); reject(new Error('cannot decode image')) }
          el.src = blobUrl!
        })
      }
    }

    try {
      return await encodeFromSource(bitmap ?? imgElement!, sourceFile)
    } finally {
      bitmap?.close()
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }

  return isMobile ? runWithDecodeSemaphore(decodeAndEncode) : decodeAndEncode()
}

// ─── Preview thumbnail ────────────────────────────────────────────────────────
// 400 px covers the 64×64 CSS thumbnail at 3× DPR (192 px physical) with room to spare.
// ~40 KB JPEG per preview — 100 previews = ~4 MB, still very manageable.
// Previously 120 px which looked pixelated on high-DPI Samsung/iPhone screens.

const PREVIEW_MAX_DIM = 400

async function tinyPreviewFromSource(src: ImageBitmap | HTMLImageElement): Promise<string> {
  try {
    const sw = src instanceof ImageBitmap ? src.width : (src as HTMLImageElement).naturalWidth
    const sh = src instanceof ImageBitmap ? src.height : (src as HTMLImageElement).naturalHeight
    if (!sw || !sh) return ''
    const scale = Math.min(1, PREVIEW_MAX_DIM / Math.max(sw, sh))
    const tw = Math.max(1, Math.round(sw * scale))
    const th = Math.max(1, Math.round(sh * scale))
    const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(tw, th)
      : Object.assign(document.createElement('canvas'), { width: tw, height: th })
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) return ''
    ctx.drawImage(src as CanvasImageSource, 0, 0, tw, th)
    const blob = canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 })
      : await new Promise<Blob | null>(res => (canvas as HTMLCanvasElement).toBlob(res, 'image/jpeg', 0.6))
    return blob ? URL.createObjectURL(blob) : ''
  } catch {
    return ''
  }
}

type Props = {
  album: Album
  onPhotosUploaded?: () => void
}

type PendingItem = {
  file: File
  compressed?: File  // pre-compressed during addFiles — upload uses this, no second decode needed
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

// Extracts just the JPEG portion from files that have non-JPEG data appended (Samsung Motion
// Photos = JPEG + embedded MP4). Walks the JPEG segment structure to find the real end-of-image
// marker (0xFF 0xD9) and returns a Blob truncated there. Returns the original file unchanged
// when no extra data is found or the file doesn't start with a JPEG signature.
async function extractJpegBytes(file: File): Promise<Blob> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return file
  let i = 2
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xFF) break
    while (i < bytes.length && bytes[i] === 0xFF) i++
    const marker = bytes[i++]
    if (marker === 0xD9) return buf.byteLength === i ? file : new Blob([buf.slice(0, i)], { type: 'image/jpeg' })
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) continue
    if (i + 1 >= bytes.length) break
    const segLen = view.getUint16(i, false)
    if (marker === 0xDA) {
      i += segLen
      while (i < bytes.length - 1) {
        if (bytes[i] !== 0xFF) { i++; continue }
        const b = bytes[i + 1]
        if (b === 0xD9) { i += 2; return buf.byteLength === i ? file : new Blob([buf.slice(0, i)], { type: 'image/jpeg' }) }
        if (b === 0x00 || (b >= 0xD0 && b <= 0xD7)) { i += 2; continue }
        break
      }
    } else {
      i += segLen
    }
  }
  return file
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

// Stagger consecutive mobile uploads by 800 ms so two workers never hit supabase.co at
// exactly the same instant. This prevents the carrier burst-drop that causes deterministic
// "Failed to fetch" with UPLOAD_CONCURRENCY_MOBILE = 2, while still allowing both workers
// to transfer in parallel (one started 800 ms earlier than the other).
let _mobileUploadLastStartMs = 0
const MOBILE_UPLOAD_STAGGER_MS = 800

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
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches

  // Stagger: ensure no two mobile uploads start within MOBILE_UPLOAD_STAGGER_MS of each other.
  if (isMobile) {
    const elapsed = Date.now() - _mobileUploadLastStartMs
    if (elapsed < MOBILE_UPLOAD_STAGGER_MS) await wait(MOBILE_UPLOAD_STAGGER_MS - elapsed)
    _mobileUploadLastStartMs = Date.now()
  }
  // Mobile: 6 attempts, 8 s max backoff — extra retries cover Wi-Fi blips lasting > 7.5 s.
  // Desktop: 8 attempts, 16 s max backoff — broadband connections recover slower from ISP blips.
  const maxAttempts = isMobile ? 6 : 8
  const maxBackoffMs = isMobile ? 8_000 : 16_000
  let lastError: Error = new Error('Upload failed')
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      if (attempt < maxAttempts) {
        const retryAfterMs = (lastError as Error & { retryAfterMs?: number }).retryAfterMs
        const backoff = retryAfterMs && retryAfterMs > 0
          ? Math.min(retryAfterMs, 30_000)
          : Math.min(500 * Math.pow(2, attempt - 1), maxBackoffMs)
        await wait(backoff)
      }
    }
  }
  throw lastError
}

export default function UploadZone({ album, onPhotosUploaded }: Props) {
  const [pending, setPending] = useState<PendingItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [preparingProgress, setPreparingProgress] = useState<{ done: number; total: number } | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<PendingItem[]>([])
  type BgUploadState = { status: 'uploading' } | { status: 'done'; row: PhotoInsertRow } | { status: 'failed' }
  const bgUploads = useRef<Map<File, BgUploadState>>(new Map())
  // Semaphore for background uploads: limits concurrency so 100 prepared files don't
  // all fire XHRs simultaneously (which causes network congestion and "failed to fetch").
  const bgSem = useRef<{ n: number; q: Array<() => void> }>({ n: 0, q: [] })


  const caps = album.upload_caps ?? DEFAULT_UPLOAD_CAPS

  function startBgUpload(fn: () => Promise<unknown>): void {
    const sem = bgSem.current
    const isMob = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
    const limit = isMob ? UPLOAD_CONCURRENCY_MOBILE : UPLOAD_CONCURRENCY_DESKTOP
    const go = () => { sem.n++; void fn().finally(() => { sem.n--; sem.q.shift()?.() }) }
    if (sem.n < limit) go(); else sem.q.push(go)
  }

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
    bgUploads.current.clear()
    bgSem.current = { n: 0, q: [] }
    setPreparing(true)

    const filesArr = Array.from(files)
    setPreparingProgress({ done: 0, total: filesArr.length })
    // Pre-allocated so parallel workers can write results in file order.
    const itemSlots: (PendingItem | null)[] = new Array(filesArr.length).fill(null)
    const rejected: string[] = []

    const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
    // Desktop: 4 parallel workers — plenty of RAM, fast GPU.
    // Mobile: 2 workers. Each 12 MP photo decoded to ImageBitmap = ~48 MB GPU memory.
    // 3 simultaneous = ~144 MB → still OOM on Z Flip3 (confirmed). 2 = ~96 MB, safe.
    const ADDFILES_CONCURRENCY = isMobile ? 3 : 4
    let cursor = 0

    async function prepareWorker() {
      while (cursor < filesArr.length) {
        const myIndex = cursor++
        const file = filesArr[myIndex]
        const kind = detectKind(file)
        if (!kind) {
          rejected.push(`${file.name}: unsupported file type`)
          setPreparingProgress(p => p ? { ...p, done: p.done + 1 } : null)
          continue
        }
        const cap = kind === 'video' ? caps.video : caps.image
        if (file.size > cap) {
          rejected.push(`${file.name}: ${formatFileSize(file.size)} exceeds ${formatFileSize(cap)} limit`)
          setPreparingProgress(p => p ? { ...p, done: p.done + 1 } : null)
          continue
        }

        const heic = kind === 'image' && isHeicFile(file)
        let previewUrl: string
        let compressed: File | undefined

        if (kind === 'image' && !heic) {
          // Single decode pass: validate decodability, tiny preview, AND pre-compress for upload.
          // uploadItem reads item.compressed so processImageForUpload is never called again —
          // eliminating the double-decode that caused 41 "cannot decode image" failures.
          type PrepResult = { error: string } | { preview: string; compressed: File | undefined }
          const doWork = async (): Promise<PrepResult> => {
            let bitmap: ImageBitmap | null = null
            let imgEl: HTMLImageElement | null = null
            let imgUrl: string | null = null
            let sourceFile = file

            // S1: createImageBitmap on original
            try { bitmap = await createImageBitmap(file) } catch { /* next */ }

            // S2: Samsung Motion Photos — JPEG with embedded MP4 after the EOI marker
            if (!bitmap && /^image\/jpe?g$/i.test(file.type)) {
              try {
                const jpegOnly = await extractJpegBytes(file)
                if (jpegOnly !== file) {
                  bitmap = await createImageBitmap(jpegOnly)
                  sourceFile = new File([jpegOnly], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified })
                }
              } catch { /* next */ }
            }

            // S3: <img> element — more permissive, handles unusual color profiles
            if (!bitmap) {
              imgUrl = URL.createObjectURL(file)
              try {
                imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
                  const el = new Image()
                  el.onload = () => resolve(el)
                  el.onerror = () => reject()
                  el.src = imgUrl!
                })
              } catch {
                URL.revokeObjectURL(imgUrl)
                imgUrl = null
              }
            }

            // S4: HEIC conversion — some Android OEMs label HEIC files as image/jpeg
            if (!bitmap && !imgEl) {
              try {
                const heicFile = await convertHeicToJpeg(file)
                bitmap = await createImageBitmap(heicFile)
                sourceFile = heicFile
              } catch {
                // Mobile codec gap: createImageBitmap + <img> + HEIC conversion all failed.
                // Upload the original rather than rejecting — EXIF-stripped for JPEG,
                // as-is for WebP/AVIF/PNG (already web-native, server/CDN handles them).
                // File size is already within cap (checked above).
                const stripped = /^image\/jpe?g$/i.test(file.type)
                  ? await stripExifClientSide(file).catch(() => file)
                  : file
                return { preview: URL.createObjectURL(file), compressed: stripped }
              }
            }

            try {
              const src = bitmap ?? imgEl!
              const tiny = await tinyPreviewFromSource(src)
              let comp: File | undefined
              try { comp = await encodeFromSource(src, sourceFile) } catch { /* uploadItem re-processes */ }
              return { preview: tiny || URL.createObjectURL(file), compressed: comp }
            } finally {
              bitmap?.close()
              if (imgUrl) URL.revokeObjectURL(imgUrl)
            }
          }

          const result: PrepResult = await doWork()
          if ('error' in result) {
            rejected.push(result.error)
            setPreparingProgress(p => p ? { ...p, done: p.done + 1 } : null)
            continue
          }
          previewUrl = result.preview
          compressed = result.compressed
        } else if (heic) {
          previewUrl = URL.createObjectURL(file)
          try {
            compressed = await processImageForUpload(file)
          } catch {
            // pre-compression failed; uploadItem falls back to processImageForUpload
          }
        } else {
          previewUrl = URL.createObjectURL(file)
        }

        itemSlots[myIndex] = { file, compressed, preview: previewUrl, kind, caption: '', author: '', heic }
        setPreparingProgress(p => p ? { ...p, done: p.done + 1 } : null)
        // Kick off background upload through the semaphore (max 2 concurrent on mobile,
        // UPLOAD_CONCURRENCY_DESKTOP on desktop) so files upload while the user reviews
        // captions without flooding the network with 100 simultaneous XHRs.
        const bgItem = itemSlots[myIndex]
        if (bgItem) {
          bgUploads.current.set(file, { status: 'uploading' })
          startBgUpload(() => uploadItem(bgItem).then(row => {
            bgUploads.current.set(file, { status: 'done', row })
          }).catch(() => {
            bgUploads.current.set(file, { status: 'failed' })
          }))
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(ADDFILES_CONCURRENCY, filesArr.length) }, prepareWorker))

    setPreparingProgress(null)
    const next = itemSlots.filter((item): item is PendingItem => item !== null)

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
      if (target) {
        URL.revokeObjectURL(target.preview)
        // If already background-uploaded to storage (not yet in DB), delete it now
        const bg = bgUploads.current.get(target.file)
        if (bg?.status === 'done' && bg.row.storage_backend === 'supabase') {
          void supabase.storage.from('Photos').remove([bg.row.storage_path]).catch(() => {})
        }
        bgUploads.current.delete(target.file)
      }
      return prev.filter((_, i) => i !== index)
    })
  }

  async function uploadItem(item: PendingItem, onVideoProgress?: (pct: number) => void): Promise<PhotoInsertRow> {
    // ── Image path ────────────────────────────────────────────────────────────
    if (item.kind === 'image') {
      // Use the file pre-compressed during addFiles; fall back if pre-compression failed.
      const processed = item.compressed ?? await processImageForUpload(item.file)
      const ext = extensionFor(processed, 'image')
      const path = `${album.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      await uploadToSupabaseStorage(processed, path, processed.type)

      const mainUrl = supabase.storage.from('Photos').getPublicUrl(path).data.publicUrl
      // thumb_url uses Supabase's on-demand image transform (same as OG images).
      // No separate thumbnail upload needed — eliminates one XHR per photo.
      const thumbUrl = mainUrl
        .replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
        + '?width=600&quality=80'

      return {
        storage_path: path,
        storage_backend: 'supabase',
        url: mainUrl,
        caption: item.caption.trim() || null,
        author_name: item.author.trim() || null,
        media_type: 'image',
        poster_path: null, poster_url: null,
        stream_uid: null, stream_iframe_url: null, stream_thumbnail_url: null,
        thumb_path: null, thumb_url: thumbUrl,
        duration_seconds: null,
      }
    }

    // ── Video path ────────────────────────────────────────────────────────────
    const ext = extensionFor(item.file, 'video')
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    try {
      const stream = await uploadVideoToStream(item.file, album.id, filename)
      return {
        storage_path: `${album.id}/${stream.stream_uid}.stream`,
        storage_backend: 'stream',
        url: stream.stream_iframe_url,
        caption: item.caption.trim() || null,
        author_name: item.author.trim() || null,
        media_type: 'video',
        poster_path: null, poster_url: stream.stream_thumbnail_url,
        stream_uid: stream.stream_uid,
        stream_iframe_url: stream.stream_iframe_url,
        stream_thumbnail_url: stream.stream_thumbnail_url,
        thumb_path: null, thumb_url: null,
        duration_seconds: null,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/503|not configured/i.test(msg)) {
        console.error(`[stream] upload FAILED for "${item.file.name}"; falling back to R2:`, msg)
      }
    }

    // Mobile always uses multipart: chunks go browser → R2 directly via presigned PUT URL.
    // The single-file FormData path (uploadToR2) routes through the Worker proxy, which carrier
    // networks reset far more aggressively than the presigned direct-to-R2 connection.
    // Outer retry loop: if multipart exhausts its per-chunk retries (carrier dropped then
    // reconnected), a fresh uploadVideoMultipart call starts a brand-new multipart session and
    // retransmits from chunk 1. 3 full attempts on mobile catches the cases chunk-level retries
    // can't — a connection that's down for >30 s and then recovers.
    const isMobileVideo = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
    const maxVideoAttempts = isMobileVideo ? 3 : 1
    let videoRes: R2UploadResult | null = null
    let lastVideoErr: Error = new Error('Video upload failed')
    for (let vAttempt = 1; vAttempt <= maxVideoAttempts; vAttempt++) {
      try {
        videoRes = (isMobileVideo || item.file.size > MULTIPART_THRESHOLD)
          ? await uploadVideoMultipart(item.file, album.id, filename, onVideoProgress)
          : await uploadToR2(item.file, album.id, filename, 'video', onVideoProgress)
        break
      } catch (e) {
        lastVideoErr = e instanceof Error ? e : new Error(String(e))
        if (vAttempt < maxVideoAttempts) await wait(Math.min(4000 * vAttempt, 15000))
      }
    }
    // Last resort for mobile: if all multipart attempts failed, try the single-file
    // path for small videos (≤ 30 MB). It uses a different Worker endpoint than
    // multipart — if the multipart route has an issue this attempt can still succeed.
    if (!videoRes && isMobileVideo && item.file.size <= 30 * 1024 * 1024) {
      try {
        videoRes = await uploadToR2(item.file, album.id, filename, 'video', onVideoProgress)
      } catch { /* throw original error below */ }
    }
    if (!videoRes) throw lastVideoErr
    const res = videoRes

    return {
      storage_path: res.storage_path,
      storage_backend: 'r2',
      url: res.url,
      caption: item.caption.trim() || null,
      author_name: item.author.trim() || null,
      media_type: 'video',
      poster_path: null, poster_url: null,
      stream_uid: null, stream_iframe_url: null, stream_thumbnail_url: null,
      thumb_path: null, thumb_url: null,
      duration_seconds: null,
    }
  }

  async function uploadAll() {
    if (pending.length === 0) return
    const queue = [...pending]
    setUploading(true)
    setUploadError('')

    const rows: (PhotoInsertRow | null)[] = new Array(queue.length).fill(null)
    const failureMessages: string[] = []

    // Check if background uploads have already finished everything
    // Only count as "all done" if every item succeeded in background.
    // Failed bg items must go through the worker path to get re-uploaded.
    const allBgDone = queue.every(item => bgUploads.current.get(item.file)?.status === 'done')

    if (allBgDone) {
      // Everything uploaded in background — animate 0→100% and go straight to DB save
      setUploadStatus({ fileName: `${queue.length} item${queue.length === 1 ? '' : 's'}`, index: queue.length, total: queue.length, phase: 'Uploading', percent: 0 })
      for (let p = 10; p <= 100; p += 10) {
        setUploadStatus(s => s ? { ...s, percent: p } : s)
        await wait(55)
      }
      queue.forEach((item, i) => {
        const bg = bgUploads.current.get(item.file)
        if (bg?.status === 'done') {
          rows[i] = { ...bg.row, caption: item.caption.trim() || null, author_name: item.author.trim() || null }
        } else {
          failureMessages.push(`${item.file.name}: upload failed in background`)
        }
        URL.revokeObjectURL(item.preview)
      })
    } else {
      // Some still uploading — show real progress, using bg results where available
      const coarsePointer = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
      const concurrency = Math.min(coarsePointer ? UPLOAD_CONCURRENCY_MOBILE : UPLOAD_CONCURRENCY_DESKTOP, queue.length)
      let completed = 0
      let cursor = 0

      setUploadStatus({ fileName: `${queue.length} item${queue.length === 1 ? '' : 's'}`, index: 0, total: queue.length, phase: 'Uploading', percent: 0 })

      async function worker() {
        while (cursor < queue.length) {
          const myIndex = cursor++
          const item = queue[myIndex]
          try {
            let bg = bgUploads.current.get(item.file)
            // Wait if still uploading in background
            while (bg?.status === 'uploading') { await wait(50); bg = bgUploads.current.get(item.file) }
            if (bg?.status === 'done') {
              rows[myIndex] = { ...bg.row, caption: item.caption.trim() || null, author_name: item.author.trim() || null }
              // Pace pre-uploaded files at ~real upload speed so the bar rises from 0
              // naturally — user shouldn't perceive a jump or notice background uploading.
              await wait(1000)
            } else {
              const base = Math.max(4, Math.round((completed / queue.length) * 90))
              const next = Math.max(4, Math.round(((completed + 1) / queue.length) * 90))
              rows[myIndex] = await uploadItem(item, (videoPct) => {
                setUploadStatus(s => s ? { ...s, percent: Math.round(base + (next - base) * videoPct / 100) } : s)
              })
            }
            URL.revokeObjectURL(item.preview)
          } catch (e) {
            failureMessages.push(`${item.file.name}: ${e instanceof Error ? e.message : String(e)}`)
          }
          completed++
          setUploadStatus({ fileName: item.file.name, index: completed, total: queue.length, phase: completed === queue.length ? 'Saving to album' : 'Uploading', percent: Math.max(4, Math.round((completed / queue.length) * 90)) })
        }
      }

      const runWorkers = () => Promise.all(Array.from({ length: concurrency }, worker))
      if (typeof navigator !== 'undefined' && 'locks' in navigator) {
        await navigator.locks.request('hushare-upload', runWorkers)
      } else {
        await runWorkers()
      }
    }

    setUploadStatus({ fileName: `${queue.length} item${queue.length === 1 ? '' : 's'}`, index: queue.length, total: queue.length, phase: 'Saving to album', percent: 98 })

    const successRows = rows.filter((r): r is PhotoInsertRow => r !== null)
    const failedItems = queue.filter((_, i) => rows[i] === null)

    let serverRejectedCount = 0
    if (successRows.length > 0) {
      try {
        for (let i = 0; i < successRows.length; i += 100) {
          const result = await saveUploadedRows(successRows.slice(i, i + 100))
          serverRejectedCount += result.rejected
        }
        onPhotosUploaded?.()
      } catch (e) {
        const message = `Save failed: ${e instanceof Error ? e.message : 'Could not save uploaded files'}`
        setUploadError(message)
        showAppToast(message, 'error')
        setUploading(false)
        setUploadStatus(null)
        return
      }
      queue.forEach((item, i) => {
        const row = rows[i]
        if (!row || row.media_type !== 'video') return
        if (row.storage_backend === 'stream') return
        if (item.file.size > POSTER_MAX_BYTES) return
        posterQueue.push({ file: item.file, albumId: album.id, storagePath: row.storage_path })
      })
      void processPosterQueue()
      queue.forEach((item, i) => {
        const row = rows[i]
        if (!row || row.media_type !== 'video' || row.storage_backend !== 'stream') return
        if (!row.stream_uid) return
        mirrorQueue.push({ file: item.file, albumId: album.id, storagePath: row.storage_path, baseId: row.stream_uid })
      })
      void processMirrorQueue()
    }

    if (failedItems.length > 0) {
      setPending(failedItems)
      const detail = failureMessages[0] ? ` — ${failureMessages[0]}` : ''
      const msg = successRows.length > 0
        ? `${successRows.length} uploaded, ${failedItems.length} failed${detail}`
        : `${failedItems.length} file${failedItems.length !== 1 ? 's' : ''} failed${detail}`
      setUploadError(msg)
      showAppToast(msg, 'error')
    } else {
      setPending([])
      if (serverRejectedCount > 0) {
        showAppToast(`${queue.length - serverRejectedCount} uploaded, ${serverRejectedCount} skipped by server.`, 'error')
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

  // ─── Pipeline: process + upload concurrently ──────────────────────────────
  // Files are encoded and uploaded at the same time — as soon as a photo is ready
  // it goes straight to Supabase/R2 without waiting for the rest to finish processing.
  async function processAndUploadAll(inputFiles: FileList | null) {
    if (uploading || preparing || !inputFiles || inputFiles.length === 0) return
    const filesArr = Array.from(inputFiles)
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
    const PROC = isMobile ? 2 : 4
    // Mobile: 1 upload worker prevents concurrent memory pressure that caused 86 rejections.
    // The single worker still fully overlaps with processing (upload rate ≥ processing rate).
    // Desktop: full concurrency — no memory pressure risk.
    const UPLOAD = Math.min(isMobile ? 1 : UPLOAD_CONCURRENCY_DESKTOP, filesArr.length)

    setUploading(true)
    setUploadError('')
    setUploadStatus({ fileName: `${filesArr.length} item${filesArr.length === 1 ? '' : 's'}`, index: 0, total: filesArr.length, phase: 'Uploading', percent: 2 })

    type QueueEntry = { item: PendingItem; fileIndex: number }
    const readyQueue: QueueEntry[] = []
    const rows: (PhotoInsertRow | null)[] = new Array(filesArr.length).fill(null)
    const failureMessages: string[] = []
    const rejected: string[] = []
    let procCursor = 0
    let uploadCursor = 0
    let procDone = false
    let uploadCompleted = 0

    async function processOne(file: File): Promise<PendingItem | null> {
      const kind = detectKind(file)
      if (!kind) { rejected.push(`${file.name}: unsupported file type`); return null }
      const cap = kind === 'video' ? caps.video : caps.image
      if (file.size > cap) { rejected.push(`${file.name}: ${formatFileSize(file.size)} exceeds ${formatFileSize(cap)} limit`); return null }
      const heic = kind === 'image' && isHeicFile(file)
      let preview = URL.createObjectURL(file)
      let compressed: File | undefined

      if (kind === 'image' && !heic) {
        let bitmap: ImageBitmap | null = null
        let imgEl: HTMLImageElement | null = null
        let imgUrl: string | null = null
        let sourceFile = file
        try { bitmap = await createImageBitmap(file) } catch { /* next */ }
        if (!bitmap && /^image\/jpe?g$/i.test(file.type)) {
          try {
            const jpegOnly = await extractJpegBytes(file)
            if (jpegOnly !== file) {
              bitmap = await createImageBitmap(jpegOnly)
              sourceFile = new File([jpegOnly], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified })
            }
          } catch { /* next */ }
        }
        if (!bitmap) {
          imgUrl = URL.createObjectURL(file)
          try {
            imgEl = await new Promise<HTMLImageElement>((res, rej) => {
              const el = new Image(); el.onload = () => res(el); el.onerror = () => rej(); el.src = imgUrl!
            })
          } catch { URL.revokeObjectURL(imgUrl); imgUrl = null }
        }
        if (!bitmap && !imgEl) {
          try {
            const heicFile = await convertHeicToJpeg(file)
            bitmap = await createImageBitmap(heicFile)
            sourceFile = heicFile
          } catch {
            const stripped = /^image\/jpe?g$/i.test(file.type)
              ? await stripExifClientSide(file).catch(() => file)
              : file
            return { file, compressed: stripped, preview, kind, caption: '', author: '', heic: false }
          }
        }
        try {
          const src = bitmap ?? imgEl!
          const tiny = await tinyPreviewFromSource(src)
          if (tiny) { URL.revokeObjectURL(preview); preview = tiny }
          try { compressed = await encodeFromSource(src, sourceFile) } catch { /* uploadItem re-processes */ }
        } finally {
          bitmap?.close()
          if (imgUrl) URL.revokeObjectURL(imgUrl)
        }
      } else if (heic) {
        try { compressed = await processImageForUpload(file) } catch { /* uploadItem re-processes */ }
      }
      return { file, compressed, preview, kind, caption: '', author: '', heic }
    }

    async function processingWorker() {
      while (procCursor < filesArr.length) {
        const myI = procCursor++
        const item = await processOne(filesArr[myI])
        if (item) readyQueue.push({ item, fileIndex: myI })
      }
    }

    async function uploadWorker() {
      while (true) {
        if (uploadCursor < readyQueue.length) {
          const myI = uploadCursor++
          const { item, fileIndex } = readyQueue[myI]
          try {
            rows[fileIndex] = await uploadItem(item)
            if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview)
          } catch (e) {
            failureMessages.push(`${item.file.name}: ${e instanceof Error ? e.message : String(e)}`)
          }
          uploadCompleted++
          setUploadStatus({ fileName: item.file.name, index: uploadCompleted, total: filesArr.length, phase: 'Uploading', percent: Math.max(4, Math.round((uploadCompleted / filesArr.length) * 90)) })
        } else if (procDone && uploadCursor >= readyQueue.length) {
          break
        } else {
          await wait(20)
        }
      }
    }

    const runPipeline = async () => {
      await Promise.all([
        Promise.all(Array.from({ length: Math.min(PROC, filesArr.length) }, processingWorker)).then(() => { procDone = true }),
        Promise.all(Array.from({ length: UPLOAD }, uploadWorker)),
      ])
    }

    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      await navigator.locks.request('hushare-upload', runPipeline)
    } else {
      await runPipeline()
    }

    setUploadStatus({ fileName: `${filesArr.length} item${filesArr.length === 1 ? '' : 's'}`, index: filesArr.length, total: filesArr.length, phase: 'Saving to album', percent: 95 })

    const successRows = rows.filter((r): r is PhotoInsertRow => r !== null)
    let serverRejectedCount = 0
    if (successRows.length > 0) {
      try {
        for (let i = 0; i < successRows.length; i += 100) {
          const result = await saveUploadedRows(successRows.slice(i, i + 100))
          serverRejectedCount += result.rejected
        }
        onPhotosUploaded?.()
      } catch (e) {
        const message = `Save failed: ${e instanceof Error ? e.message : 'Could not save uploaded files'}`
        setUploadError(message); showAppToast(message, 'error'); setUploading(false); setUploadStatus(null); return
      }
      filesArr.forEach((file, i) => {
        const row = rows[i]
        if (!row || row.media_type !== 'video') return
        if (row.storage_backend === 'stream') {
          if (row.stream_uid) mirrorQueue.push({ file, albumId: album.id, storagePath: row.storage_path, baseId: row.stream_uid })
        } else if (file.size <= POSTER_MAX_BYTES) {
          posterQueue.push({ file, albumId: album.id, storagePath: row.storage_path })
        }
      })
      void processPosterQueue()
      void processMirrorQueue()
    }

    const failedCount = failureMessages.length
    if (rejected.length > 0 || failedCount > 0) {
      const parts: string[] = []
      if (successRows.length > 0) parts.push(`${successRows.length} uploaded`)
      if (failedCount > 0) parts.push(`${failedCount} failed — ${failureMessages[0] ?? ''}`)
      if (rejected.length > 0) parts.push(`${rejected.length} skipped: ${rejected[0]}`)
      const msg = parts.join(', ')
      setUploadError(msg); showAppToast(msg, 'error')
    } else {
      showAppToast(serverRejectedCount > 0
        ? `${successRows.length} uploaded, ${serverRejectedCount} skipped by server.`
        : `${filesArr.length - rejected.length} file${filesArr.length - rejected.length !== 1 ? 's' : ''} uploaded.`,
        serverRejectedCount > 0 ? 'error' : undefined)
    }
    setUploading(false)
    setUploadStatus(null)
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
          <div className="mt-3">
            <p className="text-xs font-semibold" style={{ color: '#254F22' }}>
              {preparingProgress
                ? `Preparing ${preparingProgress.done} / ${preparingProgress.total}…`
                : 'Preparing files…'}
            </p>
            {preparingProgress && preparingProgress.total > 0 && (
              <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: '#E8E0D0' }}>
                <div
                  className="h-full transition-all duration-300"
                  style={{ width: `${Math.round(preparingProgress.done / preparingProgress.total * 100)}%`, background: '#8B6F4E' }}
                />
              </div>
            )}
          </div>
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

      {uploadError && (
        <div className="mt-4 text-sm p-3 rounded-lg flex items-start justify-between gap-3" style={{ background: '#FEE2E2', color: '#C0392B' }}>
          <p>{uploadError}</p>
          <button type="button" onClick={() => { setUploadError(''); setUploadStatus(null) }} className="font-semibold hover:underline flex-none" style={{ color: '#7A2A1F' }}>Dismiss</button>
        </div>
      )}
      {uploadStatus && (
        <div className="mt-4 rounded-xl p-3" style={{ background: '#F5F0E8', border: '1px solid #DDD5C5' }}>
          <div className="flex items-center justify-between gap-3 text-xs mb-2" style={{ color: '#7C5C3E' }}>
            <span className="truncate">{uploadStatus.phase} - {uploadStatus.fileName}</span>
            <span className="flex-none">{uploadStatus.index}/{uploadStatus.total} - {uploadStatus.percent}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: '#E8E0D0' }}>
            <div className="h-full transition-all" style={{ width: `${uploadStatus.percent}%`, background: '#254F22' }} />
          </div>
        </div>
      )}

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

          <button
            onClick={uploadAll}
            disabled={uploading}
            className="hush-press w-full font-semibold rounded-xl py-3 disabled:cursor-not-allowed overflow-hidden relative"
            style={{
              background: uploading
                ? `linear-gradient(to right, #1b3d19 ${uploadStatus?.percent ?? 0}%, #254F22 ${uploadStatus?.percent ?? 0}%)`
                : '#254F22',
              color: '#FDFAF5',
              transition: 'background 1s ease',
            }}
          >
            {uploading
              ? `Uploading ${uploadStatus?.percent ?? 0}%…`
              : `Upload ${pending.length} item${pending.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
