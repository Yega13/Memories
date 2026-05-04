import { createBrowserClient } from '@supabase/ssr'
import type { MediaDisplayFilter, MediaHoverEffect, MobileGridColumns } from '@/lib/media-display'

export type { MediaDisplayFilter, MediaHoverEffect, MobileGridColumns } from '@/lib/media-display'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

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
  media_hover?: MediaHoverEffect
  mobile_grid_columns?: MobileGridColumns
  password_protected?: boolean
  upload_caps?: { image: number; video: number }
  created_at: string
}

export type MediaType = 'image' | 'video'
export type StorageBackend = 'supabase' | 'r2'

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
  sort_order: number | null
}
