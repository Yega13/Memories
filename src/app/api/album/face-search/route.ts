import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { searchFacesByImage } from '@/lib/rekognition'

export const runtime = 'nodejs'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_SELFIE_BYTES = 5 * 1024 * 1024

const SLUG_RE = /^[a-zA-Z0-9._-]{1,200}$/
function isValidSlug(s: string): boolean { return SLUG_RE.test(s) }

// In-memory rate limiter — 10 searches per IP per 60 seconds.
// Per-isolate, not globally consistent, but Cloudflare's consistent-hash routing sends
// a single IP to the same isolate repeatedly, making this effective against looping abuse.
const RL_MAX = 10
const RL_WINDOW_MS = 60_000
const rlMap = new Map<string, { count: number; windowStart: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rlMap.get(ip)
  if (!entry || now - entry.windowStart > RL_WINDOW_MS) {
    rlMap.set(ip, { count: 1, windowStart: now })
    // Prune stale entries occasionally to avoid unbounded map growth.
    if (rlMap.size > 5000) {
      for (const [k, v] of rlMap) {
        if (now - v.windowStart > RL_WINDOW_MS * 2) rlMap.delete(k)
      }
    }
    return false
  }
  if (entry.count >= RL_MAX) return true
  entry.count++
  return false
}

export async function POST(req: Request) {
  try {
    return await handlePost(req)
  } catch (err) {
    // Without this outer catch, any unhandled error (e.g. an AWS Rekognition error not in the
    // explicit list below) crashes the Worker and Cloudflare returns its 503 HTML interstitial
    // — which the client can't parse, so the user sees a useless "Server error (503): <!DOCTYPE
    // html>" message. Logging the real reason here lets us diagnose via `wrangler tail`.
    const name = (err as { name?: string }).name ?? 'Unknown'
    const message = err instanceof Error ? err.message : String(err)
    console.error('[face-search] unhandled:', name, message)
    return NextResponse.json(
      { error: `Face search failed (${name}). Please try again or contact support.` },
      { status: 500, headers: NO_STORE },
    )
  }
}

async function handlePost(req: Request) {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown'
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many searches. Please wait a minute and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': '60' } },
    )
  }

  let slug: string
  let selfieBytes: Uint8Array

  try {
    const form = await req.formData()
    slug = String(form.get('slug') ?? '').trim()
    const file = form.get('selfie')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing selfie file' }, { status: 400, headers: NO_STORE })
    }
    if (file.size > MAX_SELFIE_BYTES) {
      return NextResponse.json({ error: 'Selfie too large (max 5MB)' }, { status: 400, headers: NO_STORE })
    }
    selfieBytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  }

  if (!slug || !isValidSlug(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  const { data: album } = await admin
    .from('albums')
    .select('id')
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .maybeSingle<{ id: string }>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  // Verify there are indexed photos — otherwise collection may not exist yet
  const { count: indexedCount } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', album.id)
    .not('face_ids', 'is', null)

  if (!indexedCount || indexedCount === 0) {
    return NextResponse.json(
      { error: 'No photos have been indexed yet. Please wait for indexing to complete.' },
      { status: 422, headers: NO_STORE },
    )
  }

  // ensureCollection is intentionally omitted here: indexedCount > 0 guarantees the collection
  // already exists (faces can only be indexed into an existing collection). Calling it anyway
  // would add an unnecessary Rekognition round-trip (~100-300 ms) to every search.

  let matches: { photoId: string; similarity: number }[]
  try {
    matches = await searchFacesByImage(album.id, selfieBytes)
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    const message = err instanceof Error ? err.message : String(err)
    if (name === 'InvalidParameterException') {
      return NextResponse.json(
        { error: 'No face detected in selfie. Try a clearer photo facing the camera.' },
        { status: 422, headers: NO_STORE },
      )
    }
    if (name === 'ResourceNotFoundException') {
      return NextResponse.json(
        { error: 'Album not indexed yet. Please try again in a moment.' },
        { status: 422, headers: NO_STORE },
      )
    }
    // Surface other Rekognition errors with their AWS name so we can diagnose. Previously a
    // re-throw here bubbled out of the handler and Cloudflare returned a 503 HTML interstitial
    // with no clue what went wrong (AccessDenied, Throttling, etc.).
    console.error('[face-search] Rekognition error:', name, message)
    return NextResponse.json(
      { error: `Face search failed: ${name ?? 'Unknown'} — ${message.slice(0, 200)}` },
      { status: 502, headers: NO_STORE },
    )
  }

  return NextResponse.json({ matches }, { headers: NO_STORE })
}
