import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseUrl = 'https://lteovnkplhowfvbzpalp.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0ZW92bmtwbGhvd2Z2YnpwYWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMzM4NDYsImV4cCI6MjA5NjkwOTg0Nn0.RFXskvyUoaR4Ha2qfuujAi4cgI9K95lTjwjDAy8QYJQ'

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
