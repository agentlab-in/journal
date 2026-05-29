/**
 * Supabase server-side client (service-role — full DB access).
 * Use only in server components, route handlers, and API routes.
 * Never expose the service-role key to the browser.
 */
import { createClient } from '@supabase/supabase-js'

export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Set them in your .env.local file.',
    )
  }

  return createClient(url, key, {
    auth: {
      // Service-role client should not auto-refresh tokens or persist sessions.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
