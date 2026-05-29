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

  return (data as number) + 1
}
