import { createBrowserClient } from '@supabase/ssr'
import type { MediaDisplayFilter, MediaHoverEffect, MobileGridColumns, SlideshowAnimation } from '@/lib/media-display'
import type { UploadCaps } from '@/lib/media'

export type { MediaDisplayFilter, MediaHoverEffect, MobileGridColumns, SlideshowAnimation } from '@/lib/media-display'
export type { UploadCaps } from '@/lib/media'

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lteovnkplhowfvbzpalp.supabase.co'
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0ZW92bmtwbGhvd2Z2YnpwYWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMzM4NDYsImV4cCI6MjA5NjkwOTg0Nn0.RFXskvyUoaR4Ha2qfuujAi4cgI9K95lTjwjDAy8QYJQ'

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

export type Album = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  description: string | null
  // Nullable in DB — passed through as-is by the API
  background_theme: string | null
  cover_photo_id: string | null
  reveal_at: string | null
  // Normalized by the API route (never undefined on the client)
  media_radius: number
  video_autoplay: boolean
  media_filter: MediaDisplayFilter
  media_hover: MediaHoverEffect
  mobile_grid_columns: MobileGridColumns
  slideshow_interval_ms: number
  slideshow_animation: SlideshowAnimation
  // Computed by the API route from owner tier / password hash
  password_protected: boolean
  upload_caps: UploadCaps
  face_finder_enabled: boolean
  allow_guest_downloads: boolean
  created_at: string
}

export type MediaType = 'image' | 'video'
export type StorageBackend = 'supabase' | 'r2' | 'stream'

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
  stream_uid: string | null
  stream_iframe_url: string | null
  stream_thumbnail_url: string | null
  // R2 mirror of a Stream-backed video. Populated by a background job after Stream upload
  // succeeds, so the original file can be downloaded/archived even though playback goes via
  // Cloudflare Stream. Will be null until the migration adds the columns AND the mirror job
  // finishes; everything degrades gracefully when null.
  mirror_path: string | null
  mirror_url: string | null
  // Small image used by the grid tile. Generated client-side after upload and stored in
  // Supabase Storage. Lightbox + download use the original `url`. Null for legacy rows and
  // rows where thumbnail generation/upload failed — grid falls back to `url` in that case.
  thumb_path: string | null
  thumb_url: string | null
  duration_seconds: number | null
  display_radius: number | null
  display_filter: MediaDisplayFilter | null
  sort_order: number | null
  face_ids?: string[] | null
}
