import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'

// Browser-side singleton. Auth cookies are managed automatically by @supabase/ssr.
// For server-side reads (Server Components, Route Handlers), import from
// '@/lib/supabase/server' instead — it picks up cookies via next/headers.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

// Album type. `owner_token` and `password_hash` are sensitive and never
// returned to anon clients (column-level GRANT excludes them in PostgREST).
// They're declared optional so server-side code can still type the full row.
export type Album = {
  id: string
  slug: string
  owner_token?: string
  title: string
  description: string | null
  password_hash?: string | null
  is_pro: boolean
  created_at: string
}

export type MediaType = 'image' | 'video'

// "Photo" is a historical name — the row also represents videos now.
// `media_type` discriminates: images use `url` directly; videos display
// `poster_url` as a thumbnail and `url` as the playable source.
export type Photo = {
  id: string
  album_id: string
  storage_path: string
  url: string
  caption: string | null
  author_name: string | null
  created_at: string
  media_type: MediaType
  poster_path: string | null
  poster_url: string | null
  duration_seconds: number | null
}
