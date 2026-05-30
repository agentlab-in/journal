import type { SupabaseClient } from '@supabase/supabase-js'

export interface FollowUserCard {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  bio: string | null
}

// TODO(phase-9): paginate. v1 caps the list at 100 — a healthy author can
// exceed this within weeks. Likely shape: cursor on follows.created_at
// (already the ORDER BY column) + `LIMIT 50` per page.
const LIST_LIMIT = 100

type Side = 'followers' | 'following'

interface JoinedRow {
  follower_id: string
  followed_id: string
  users: {
    id: string
    username: string
    display_name: string
    avatar_url: string | null
    bio: string | null
  } | null
}

/**
 * List up to 100 follower or following user records for `userId`, ordered
 * newest-first by `follows.created_at`.
 *
 * Requires the admin (service-role) client — `public.follows` is owner-only-
 * read under RLS (migration 0002), so the anon SSR client returns zero rows
 * for any third-party viewer.
 *
 * - side='followers' → users who follow `userId` (join on follows.follower_id)
 * - side='following' → users `userId` follows (join on follows.followed_id)
 */
export async function listFollowEdges(
  admin: Pick<SupabaseClient, 'from'>,
  userId: string,
  side: Side,
): Promise<FollowUserCard[]> {
  // The joined user is the *other* side of the edge.
  const joinColumn = side === 'followers' ? 'follower_id' : 'followed_id'
  const filterColumn = side === 'followers' ? 'followed_id' : 'follower_id'

  const { data, error } = await admin
    .from('follows')
    .select(
      `follower_id, followed_id, users:${joinColumn}(id, username, display_name, avatar_url, bio)`,
    )
    .eq(filterColumn, userId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)

  if (error || !data) return []
  const rows = data as unknown as JoinedRow[]
  const out: FollowUserCard[] = []
  for (const r of rows) {
    const u = r.users
    if (!u) continue
    out.push({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      avatar_url: u.avatar_url,
      bio: u.bio,
    })
  }
  return out
}
