/**
 * Self-heal helper: guarantee a `public.users` row exists for a signed-in
 * NextAuth user.
 *
 * Why: Phase 2's `sync_user_from_next_auth_trigger` only fires when
 * `next_auth.users.github_login` is UPDATEd. Users who signed up before
 * Phase 1.1's audit-cols populator landed have `github_login = NULL` and
 * therefore no `public.users` row, so the editor's slug preview falls
 * through to `'unknown'`. Forcing those users to log out + back in to
 * trigger the populator is bad UX; instead we re-derive the row from
 * `next_auth.users` on demand and upsert it.
 *
 * Returns the username (lowercased GitHub login) or `null` when we
 * genuinely can't derive one — at which point the caller should surface
 * a clear "please sign in again" message rather than the silent
 * `unknown` fallback.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

interface NextAuthUserRow {
  id: string
  name: string | null
  image: string | null
  github_login: string | null
}

export async function ensurePublicUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const existing = await supabase
    .from('users')
    .select('username')
    .eq('id', userId)
    .maybeSingle<{ username: string }>()
  if (existing.data?.username) return existing.data.username

  const naUser = await supabase
    .schema('next_auth')
    .from('users')
    .select('id, name, image, github_login')
    .eq('id', userId)
    .maybeSingle<NextAuthUserRow>()
  if (!naUser.data) return null

  const login = naUser.data.github_login?.toLowerCase().trim()
  if (!login) return null

  await supabase
    .from('users')
    .upsert(
      {
        id: userId,
        username: login,
        display_name: naUser.data.name ?? login,
        avatar_url: naUser.data.image,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )

  const after = await supabase
    .from('users')
    .select('username')
    .eq('id', userId)
    .maybeSingle<{ username: string }>()
  return after.data?.username ?? null
}
