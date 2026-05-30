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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// POST /api/bookmarks/[postId] — idempotent bookmark
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

  const { data: postRow, error: postFetchErr } = await admin
    .from('posts')
    .select('id, deleted_at')
    .eq('id', postId)
    .single()
  if (postFetchErr || !postRow) return json(404, { error: 'post_not_found' })
  const post = postRow as { id: string; deleted_at: string | null }
  if (post.deleted_at !== null) return json(404, { error: 'post_not_found' })

  const { error: upsertErr } = await admin
    .from('bookmarks')
    .upsert(
      { user_id: userId, post_id: postId },
      { onConflict: 'user_id,post_id', ignoreDuplicates: true },
    )
  if (upsertErr) {
    return json(500, { error: 'bookmark_failed', detail: upsertErr.message })
  }

  // No count exposed publicly — bookmarks are private; the global
  // bookmark_count denorm exists for the heat formula only.
  return json(200, { bookmarked: true })
}

// ---------------------------------------------------------------------------
// DELETE /api/bookmarks/[postId] — idempotent un-bookmark
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

  const { error: deleteErr } = await admin
    .from('bookmarks')
    .delete()
    .eq('user_id', userId)
    .eq('post_id', postId)
  if (deleteErr) {
    return json(500, { error: 'unbookmark_failed', detail: deleteErr.message })
  }

  return json(200, { bookmarked: false })
}
