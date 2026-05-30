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

async function loadFollowerCount(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from('users')
    .select('follower_count')
    .eq('id', userId)
    .single()
  if (error || !data) return null
  return (data as { follower_count: number }).follower_count ?? 0
}

// ---------------------------------------------------------------------------
// POST /api/follows/[userId] — idempotent follow
// ---------------------------------------------------------------------------
export async function POST(
  _req: NextRequest | Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const followerId = session.user.id

  const { userId } = await context.params

  // Self-follow rejected up-front. The DB CHECK follows_no_self_follow
  // would also reject, but a pre-check returns a clean 400 with no DB hit.
  if (followerId === userId) {
    return json(400, { error: 'cannot_follow_self' })
  }

  if (!UUID_RE.test(userId)) return json(404, { error: 'user_not_found' })

  const admin = createAdminSupabaseClient()

  // Verify target user exists
  const { data: userRow, error: userFetchErr } = await admin
    .from('users')
    .select('id')
    .eq('id', userId)
    .single()
  if (userFetchErr || !userRow) return json(404, { error: 'user_not_found' })

  const { error: upsertErr } = await admin
    .from('follows')
    .upsert(
      { follower_id: followerId, followed_id: userId },
      { onConflict: 'follower_id,followed_id', ignoreDuplicates: true },
    )
  if (upsertErr) {
    return json(500, { error: 'follow_failed', detail: upsertErr.message })
  }

  const follower_count = await loadFollowerCount(admin, userId)
  if (follower_count === null) {
    return json(500, { error: 'count_read_failed' })
  }

  return json(200, { following: true, follower_count })
}

// ---------------------------------------------------------------------------
// DELETE /api/follows/[userId] — idempotent unfollow
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest | Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const followerId = session.user.id

  const { userId } = await context.params

  if (followerId === userId) {
    return json(400, { error: 'cannot_follow_self' })
  }

  if (!UUID_RE.test(userId)) return json(404, { error: 'user_not_found' })

  const admin = createAdminSupabaseClient()

  const { data: userRow, error: userFetchErr } = await admin
    .from('users')
    .select('id')
    .eq('id', userId)
    .single()
  if (userFetchErr || !userRow) return json(404, { error: 'user_not_found' })

  const { error: deleteErr } = await admin
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followed_id', userId)
  if (deleteErr) {
    return json(500, { error: 'unfollow_failed', detail: deleteErr.message })
  }

  const follower_count = await loadFollowerCount(admin, userId)
  if (follower_count === null) {
    return json(500, { error: 'count_read_failed' })
  }

  return json(200, { following: false, follower_count })
}
