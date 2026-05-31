/**
 * Self-heal helper: guarantee a `public.users` row exists for a signed-in
 * NextAuth user.
 *
 * Why: Phase 2's `sync_user_from_next_auth_trigger` only fires when
 * `next_auth.users.github_login` is UPDATEd. Users who signed up before
 * Phase 1.1's audit-cols populator landed have `github_login = NULL` and
 * therefore no `public.users` row, so the editor's slug preview falls
 * through to `'unknown'`. Forcing those users to log out + back in is
 * bad UX; instead we derive the GitHub login at request time and upsert.
 *
 * Resolution order:
 *   1. public.users.username — happy path, return immediately
 *   2. next_auth.users.github_login — audit column populated by Phase 1.1
 *   3. next_auth.accounts.providerAccountId for provider='github' +
 *      unauthenticated GitHub REST `GET /user/{id}` → login
 *
 * Returns the lowercased username or `null` when even GitHub can't help.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

interface NextAuthUserRow {
  id: string
  name: string | null
  image: string | null
  github_login: string | null
}

interface NextAuthAccountRow {
  providerAccountId: string
}

async function fetchGithubLoginById(githubUserId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/user/${githubUserId}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'agentlab.in/self-heal',
      },
      // Don't let a slow GitHub response block page render forever.
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { login?: string }
    return body.login?.toLowerCase() ?? null
  } catch {
    return null
  }
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
  if (!naUser.data) {
    console.error('[ensurePublicUser] no next_auth.users row for', userId)
    return null
  }

  let login = naUser.data.github_login?.toLowerCase().trim() || null

  if (!login) {
    const account = await supabase
      .schema('next_auth')
      .from('accounts')
      .select('"providerAccountId"')
      .eq('userId', userId)
      .eq('provider', 'github')
      .maybeSingle<NextAuthAccountRow>()
    const ghId = account.data?.providerAccountId
    if (!ghId) {
      console.error('[ensurePublicUser] no github account for', userId)
      return null
    }
    login = await fetchGithubLoginById(ghId)
    if (!login) {
      console.error('[ensurePublicUser] github API gave no login for id', ghId)
      return null
    }
    // Write back to next_auth.users so future requests skip the GitHub roundtrip.
    await supabase
      .schema('next_auth')
      .from('users')
      .update({ github_login: login })
      .eq('id', userId)
  }

  const upsertResult = await supabase
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
  if (upsertResult.error) {
    console.error('[ensurePublicUser] upsert failed:', upsertResult.error)
  }

  const after = await supabase
    .from('users')
    .select('username')
    .eq('id', userId)
    .maybeSingle<{ username: string }>()

  // If the row still isn't visible (rare read-after-write timing window between
  // the trigger/upsert commit and the session-callback read), wait 50 ms and
  // retry once. This is a single extra round-trip; it only fires when the upsert
  // appeared to succeed but the row isn't yet visible, which is the edge case
  // that causes username to be missing from the session on first render.
  if (!after.data?.username) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    const retry = await supabase
      .from('users')
      .select('username')
      .eq('id', userId)
      .maybeSingle<{ username: string }>()
    return retry.data?.username ?? login
  }

  return after.data.username
}
