import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// UUID shape check — narrow enough to keep malformed ids from reaching the
// DB layer (where they'd surface as noisy "invalid input syntax" errors).
// Treat malformed as not-found since they cannot match any row.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function loadPostLikeCount(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  postId: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from('posts')
    .select('like_count')
    .eq('id', postId)
    .single()
  if (error || !data) return null
  return (data as { like_count: number }).like_count ?? 0
}

// ---------------------------------------------------------------------------
// POST /api/likes/[postId] — idempotent like
// ---------------------------------------------------------------------------
export async function POST(
  _req: NextRequest | Request,
  context: { params: Promise<{ postId: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const { postId } = await context.params
  if (!UUID_RE.test(postId)) return json(404, { error: 'post_not_found' })

  const admin = createAdminSupabaseClient()

  // Validate post exists and is live
  const { data: postRow, error: postFetchErr } = await admin
    .from('posts')
    .select('id, deleted_at')
    .eq('id', postId)
    .single()
  if (postFetchErr || !postRow) return json(404, { error: 'post_not_found' })
  const post = postRow as { id: string; deleted_at: string | null }
  if (post.deleted_at !== null) return json(404, { error: 'post_not_found' })

  // Idempotent insert via upsert(ignoreDuplicates) — mirrors the pattern
  // used in lib/users/ensure-public-user.ts. The composite PK is
  // (user_id, post_id) so re-POSTs are a no-op (no error, no extra row,
  // trigger does not double-fire).
  const { error: upsertErr } = await admin
    .from('likes')
    .upsert(
      { user_id: userId, post_id: postId },
      { onConflict: 'user_id,post_id', ignoreDuplicates: true },
    )
  if (upsertErr) {
    return json(500, { error: 'like_failed', detail: upsertErr.message })
  }

  // Read the post-mutation count from the denorm column (trigger has fired
  // by the time the upsert RPC returns).
  const like_count = await loadPostLikeCount(admin, postId)
  if (like_count === null) {
    return json(500, { error: 'count_read_failed' })
  }

  return json(200, { liked: true, like_count })
}

// ---------------------------------------------------------------------------
// DELETE /api/likes/[postId] — idempotent unlike
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest | Request,
  context: { params: Promise<{ postId: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const { postId } = await context.params
  if (!UUID_RE.test(postId)) return json(404, { error: 'post_not_found' })

  const admin = createAdminSupabaseClient()

  const { data: postRow, error: postFetchErr } = await admin
    .from('posts')
    .select('id, deleted_at')
    .eq('id', postId)
    .single()
  if (postFetchErr || !postRow) return json(404, { error: 'post_not_found' })
  const post = postRow as { id: string; deleted_at: string | null }
  if (post.deleted_at !== null) return json(404, { error: 'post_not_found' })

  // Idempotent — DELETE on a missing row is a no-op for Postgres / PostgREST,
  // no error.
  const { error: deleteErr } = await admin
    .from('likes')
    .delete()
    .eq('user_id', userId)
    .eq('post_id', postId)
  if (deleteErr) {
    return json(500, { error: 'unlike_failed', detail: deleteErr.message })
  }

  const like_count = await loadPostLikeCount(admin, postId)
  if (like_count === null) {
    return json(500, { error: 'count_read_failed' })
  }

  return json(200, { liked: false, like_count })
}
