import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'

// Browser-side singleton. Auth cookies are managed automatically by @supabase/ssr.
// For server-side reads (Server Components, Route Handlers), import from
// '@/lib/supabase/server' instead — it picks up cookies via next/headers.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

// Album type for browser-facing album data. Sensitive columns such as
// `owner_token`, `password_hash`, and `user_id` must stay in route-local
// server types and never be added here.
//
// Tier-gated features (custom URLs, password protection, etc.) are NOT stored
// on this row. They're resolved live from the album owner's subscription via
// `getUserTier()` in `@/lib/subscriptions`. Never trust a per-row "is_pro"
// boolean — it goes stale the moment a sub is canceled or upgraded.
export type Album = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  description: string | null
  background_theme?: string | null
  media_radius?: number
  video_autoplay?: boolean
  media_filter?: MediaDisplayFilter
  // Public boolean projection of password_hash. The hash itself never
  // reaches the browser — this is what the resolver returns so the UI can
  // show "password set / not set" and the share-link copy can warn the
  // owner that visitors will need the password.
  password_protected?: boolean
  // Per-album upload caps in bytes, derived from the owner's tier. Set by
  // the resolver. UI uses these to validate uploads up-front; servers
  // re-check before honouring an upload.
  upload_caps?: { image: number; video: number }
  created_at: string
}

export type MediaType = 'image' | 'video'
export type StorageBackend = 'supabase' | 'r2'

// "Photo" is a historical name — the row also represents videos now.
// `media_type` discriminates: images use `url` directly; videos display
// `poster_url` as a thumbnail and `url` as the playable source.
// `storage_backend` indicates where the main file lives. Posters always
// share the backend of their video (currently r2).
export type Photo = {
  id: string
  album_id: string
  storage_path: string
  storage_backend: StorageBackend
  url: string
  caption: string | null
  author_name: string | null
  created_at: string
  media_type: MediaType
  poster_path: string | null
  poster_url: string | null
  duration_seconds: number | null
  display_radius: number | null
  display_filter: MediaDisplayFilter | null
}

export type MediaDisplayFilter = 'none' | 'warm' | 'cool' | 'mono' | 'vintage' | 'soft'
