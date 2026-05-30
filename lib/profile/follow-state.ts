import type { SupabaseClient } from '@supabase/supabase-js'

export interface GetFollowStateParams {
  /**
   * Admin (service-role) Supabase client. Required because the RLS policy
   * on `public.follows` only exposes rows where the viewer is either the
   * follower or the followed user (see migration 0002, "follows: read own").
   * NextAuth sessions don't carry a Supabase JWT, so an anon-key read
   * would silently return zero rows here.
   */
  admin: Pick<SupabaseClient, 'from'>
  /** The profile being viewed. */
  targetUserId: string
  /** The viewer's user id; null/undefined for anonymous viewers. */
  viewerUserId: string | null | undefined
}

/**
 * Returns true when the viewer follows the target user.
 *
 * Fast-paths:
 *   - Anonymous viewer (`viewerUserId` is null/undefined) → false.
 *   - Self-view (viewer === target) → false. Users can't follow themselves
 *     (DB CHECK `follows_no_self_follow`), so we skip the DB call entirely.
 *
 * On any Supabase error we fail safe by returning false; the FollowButton
 * will then render in "Follow" state and the user's next click will
 * reconcile against the toggle API.
 */
export async function getFollowState({
  admin,
  targetUserId,
  viewerUserId,
}: GetFollowStateParams): Promise<boolean> {
  if (!viewerUserId) return false
  if (viewerUserId === targetUserId) return false

  const { data, error } = await admin
    .from('follows')
    .select('follower_id')
    .eq('follower_id', viewerUserId)
    .eq('followed_id', targetUserId)
    .maybeSingle()

  if (error) return false
  return data != null
}
