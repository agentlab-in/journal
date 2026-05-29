import type { SupabaseClient } from '@supabase/supabase-js'

export async function getNewCommentDepth(
  admin: SupabaseClient,
  parentCommentId: string | null,
): Promise<number> {
  if (parentCommentId == null) {
    return 1
  }

  const { data, error } = await admin.rpc('comment_depth_for_parent', {
    p_parent: parentCommentId,
  })

  if (error) {
    throw new Error(error.message)
  }

  // RPC returns NULL when the parent UUID doesn't exist (NULLIF on count=0).
  // Without this guard, a bogus parent silently becomes a root comment.
  if (data == null) {
    throw new Error('parent_not_found')
  }

  return (data as number) + 1
}
