import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase/config'

// Server-side Supabase client. Reads/writes auth cookies via next/headers.
// Use in Server Components and Route Handlers. Each call creates a fresh
// client because next/headers cookies are per-request scoped.
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Components can't write cookies - safely ignored when the
          // middleware is also running, which refreshes the session there.
        }
      },
    },
  })
}
