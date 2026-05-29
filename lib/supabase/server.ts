/**
 * Supabase server-side clients.
 *
 * Two factories live here:
 *
 * 1. createServerSupabaseClient() — service-role key, full DB access. Use only
 *    in server components, route handlers, and API routes that need to bypass
 *    RLS. NEVER expose the service-role key to the browser.
 *
 * 2. createAnonServerSupabaseClient() — anon key, RLS-gated reads. Use this
 *    for unauthenticated public reads in server components (e.g. the public
 *    profile page) so the existing public-read RLS policies on `public.users`,
 *    `public.posts`, `public.pinned_posts`, `public.post_tags`, and
 *    `public.tags` are actually exercised end-to-end. Re-using the browser
 *    client here would bundle a stateful singleton into the server runtime,
 *    so we build a fresh client per request.
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

export function createAnonServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Set them in your .env.local file.',
    )
  }

  return createClient(url, key, {
    auth: {
      // Server runtime has no browser storage to persist into.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
