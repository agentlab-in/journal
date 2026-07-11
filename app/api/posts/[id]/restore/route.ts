import type { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getSession } from '@/lib/auth'
import { requireAdminApi } from '@/lib/admin'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { guardMutatingRequest } from '@/lib/route-guard'
import { logRouteError } from '@/lib/logging/error-log'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// POST /api/posts/[id]/restore
//
// Admin-only inverse of the moderation soft-delete on /api/posts/[id].
// Clears deleted_at + deletion_reason and writes a mod_actions row with
// action='restore_post'. Author-deleted posts are NOT eligible — only
// admin (deletion_reason='moderation') deletes can be restored.
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest | Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession()
  const gate = await requireAdminApi(session)
  if (gate) return gate
  const adminUserId = session!.user.id

  const guard = await guardMutatingRequest(req, { userId: adminUserId })
  if (guard.failed) return guard.response

  const { id: postId } = await context.params

  const admin = createAdminSupabaseClient()

  const { data: postRow, error: postFetchErr } = await admin
    .from('posts')
    .select('id, author_id, slug, deleted_at, deletion_reason')
    .eq('id', postId)
    .maybeSingle()

  if (postFetchErr || !postRow) {
    return json(404, { error: 'not_found' })
  }

  const post = postRow as {
    id: string
    author_id: string
    slug: string
    deleted_at: string | null
    deletion_reason: 'author' | 'moderation' | null
  }

  if (post.deleted_at === null) {
    return json(400, { error: 'not_deleted' })
  }

  if (post.deletion_reason !== 'moderation') {
    // Author-deleted posts are out of scope: restoring them would
    // republish content the author chose to remove.
    return json(400, { error: 'not_restorable', detail: post.deletion_reason ?? 'unknown' })
  }

  let reason: string | null = null
  try {
    const raw = await req.text()
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && typeof parsed.reason === 'string') {
        reason = parsed.reason.slice(0, 1000)
      }
    }
  } catch {
    // ignore — restore commonly has no body
  }

  const { error: updateErr } = await admin
    .from('posts')
    .update({ deleted_at: null, deletion_reason: null })
    .eq('id', postId)

  if (updateErr) {
    return json(500, { error: 'restore_failed', detail: updateErr.message })
  }

  // Invalidate the discovery cache so the very next request re-queries.
  // Called after the restore UPDATE succeeds.
  // Contract: discovery-cache.ts registers tags: ['posts', 'tags'].
  revalidateTag('posts', { expire: 0 })

  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: adminUserId,
    action: 'restore_post',
    target_type: 'post',
    target_id: String(postId),
    reason,
    metadata: { slug: post.slug, author_id: post.author_id },
  })
  if (modErr) {
    logRouteError(modErr, {
      route: '/api/posts/[id]/restore',
      userId: adminUserId,
      extra: { op: 'mod_actions_insert', postId },
    })
    // soft failure — restore already succeeded, do not roll back
  }

  return json(200, { ok: true })
}
