import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { streamConfig } from '@/lib/cloudflare-stream'
import type { R2Env } from '@/lib/r2'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type Check = {
  ok: boolean
  required: boolean
  message?: string
}

type Checks = Record<string, Check>

function pass(required = true): Check {
  return { ok: true, required }
}

function fail(message: string, required = true): Check {
  return { ok: false, required, message }
}

function dbErrorMessage(error: { code?: string; message?: string; details?: string | null; hint?: string | null }) {
  return JSON.stringify({
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  })
}

export async function GET() {
  const checks: Checks = {}

  let admin: ReturnType<typeof createAdminClient> | null = null
  try {
    admin = createAdminClient()
    checks.supabase_service_role = pass()
  } catch (err) {
    checks.supabase_service_role = fail(err instanceof Error ? err.message : String(err))
  }

  if (admin) {
    const albums = await admin
      .from('albums')
      .select('id, user_id, guest_uploads_enabled, allow_guest_downloads, video_autoplay, cover_photo_id')
      .limit(1)
    checks.albums_schema = albums.error ? fail(dbErrorMessage(albums.error)) : pass()

    const photos = await admin
      .from('photos')
      .select('id, album_id, storage_path, storage_backend, thumb_path, mirror_path, duration_seconds')
      .limit(1)
    checks.photos_schema = photos.error ? fail(dbErrorMessage(photos.error)) : pass()

    const rateLimit = await admin
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .limit(1)
    checks.rate_limit_schema = rateLimit.error ? fail(dbErrorMessage(rateLimit.error)) : pass()
  } else {
    checks.albums_schema = fail('Skipped because Supabase service client is unavailable')
    checks.photos_schema = fail('Skipped because Supabase service client is unavailable')
    checks.rate_limit_schema = fail('Skipped because Supabase service client is unavailable')
  }

  const ctx = getCloudflareContext()
  const env = ctx?.env as R2Env | undefined
  checks.r2_binding = env?.R2_VIDEOS ? pass() : fail('R2_VIDEOS binding is not available')
  checks.r2_public_host = (env?.R2_PUBLIC_HOST ?? process.env.R2_PUBLIC_HOST) ? pass() : fail('R2_PUBLIC_HOST is not configured')
  checks.cloudflare_stream = streamConfig() ? pass(false) : fail('Cloudflare Stream is not configured', false)

  const ok = Object.values(checks).every((check) => check.ok || !check.required)
  return NextResponse.json(
    {
      ok,
      checked_at: new Date().toISOString(),
      checks,
    },
    { status: ok ? 200 : 503, headers: NO_STORE },
  )
}
