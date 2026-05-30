import type { SupabaseClient } from '@supabase/supabase-js'

export interface EngagementState {
  liked: boolean
  bookmarked: boolean
}

export interface GetEngagementStateParams {
  admin: Pick<SupabaseClient, 'from'>
  postId: string
  userId: string | null | undefined
}

/**
 * Resolve whether the given (signed-in) user has liked and/or bookmarked
 * a specific post. Returns `{ liked: false, bookmarked: false }` when
 * `userId` is null/undefined (anonymous viewer) without hitting the DB.
 *
 * Both queries are issued in parallel via Promise.all when a userId is
 * present. The admin client is required because:
 *   - The Phase 8 RLS policies expose `likes` / `bookmarks` rows only to
 *     the row owner via `auth.uid()`.
 *   - The page renders under a NextAuth session (no Supabase JWT), so a
 *     non-service-role read would surface zero rows even when the user
 *     has in fact liked/bookmarked the post.
 *
 * On any DB error we fail safe by returning false for that signal; the
 * worst case is a momentarily empty heart/bookmark that the next click
 * will reconcile against the server response.
 */
export async function getEngagementState({
  admin,
  postId,
  userId,
}: GetEngagementStateParams): Promise<EngagementState> {
  if (!userId) {
    return { liked: false, bookmarked: false }
  }

  const [likeRes, bookmarkRes] = await Promise.all([
    admin
      .from('likes')
      .select('user_id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('bookmarks')
      .select('user_id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  return {
    liked: !likeRes.error && likeRes.data != null,
    bookmarked: !bookmarkRes.error && bookmarkRes.data != null,
  }
}
