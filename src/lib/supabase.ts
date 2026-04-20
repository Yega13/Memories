import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Album = {
  id: string
  slug: string
  owner_token: string
  title: string
  description: string | null
  password_hash: string | null
  is_pro: boolean
  created_at: string
}

export type Photo = {
  id: string
  album_id: string
  storage_path: string
  url: string
  caption: string | null
  author_name: string | null
  created_at: string
}
