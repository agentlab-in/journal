import type { NextRequest } from 'next/server'
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
// POST /api/comments/[id]/restore
//
// Admin-only inverse of the moderation soft-delete on /api/comments/[id].
// Clears deleted_at + deletion_reason and writes a mod_actions row with
// action='restore_comment'. Author-deleted comments are NOT eligible.
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

  const { id: commentId } = await context.params

  const admin = createAdminSupabaseClient()

  const { data: commentRow, error: commentFetchErr } = await admin
    .from('comments')
    .select('id, author_id, deleted_at, deletion_reason')
    .eq('id', commentId)
    .maybeSingle()

  if (commentFetchErr || !commentRow) {
    return json(404, { error: 'not_found' })
  }

  const comment = commentRow as {
    id: string
    author_id: string
    deleted_at: string | null
    deletion_reason: 'author' | 'moderation' | null
  }

  if (comment.deleted_at === null) {
    return json(400, { error: 'not_deleted' })
  }

  if (comment.deletion_reason !== 'moderation') {
    return json(400, {
      error: 'not_restorable',
      detail: comment.deletion_reason ?? 'unknown',
    })
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
    .from('comments')
    .update({ deleted_at: null, deletion_reason: null })
    .eq('id', commentId)

  if (updateErr) {
    return json(500, { error: 'restore_failed', detail: updateErr.message })
  }

  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: adminUserId,
    action: 'restore_comment',
    target_type: 'comment',
    target_id: String(commentId),
    reason,
    metadata: { author_id: comment.author_id },
  })
  if (modErr) {
    logRouteError(modErr, {
      route: '/api/comments/[id]/restore',
      userId: adminUserId,
      extra: { op: 'mod_actions_insert', commentId },
    })
  }

  return json(200, { ok: true })
}
