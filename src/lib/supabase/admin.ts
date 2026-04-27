import { createClient } from '@supabase/supabase-js'

// Server-side Supabase client using the service-role key. Bypasses RLS;
// use ONLY in webhook handlers and other trusted server code. Never import
// this from a client component or expose its key to the browser.
//
// Each call returns a fresh client to avoid state leaks between requests.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set')
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
