import type { NextRequest } from 'next/server'
import { getSession, resolveIsAdmin } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { CommentPatchBody } from '@/lib/comments/schema'
import { sanitizeCommentBody } from '@/lib/comments/sanitize'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

interface CommentRow {
  id: string
  author_id: string
  body: string
  created_at: string
  deleted_at: string | null
}

// ---------------------------------------------------------------------------
// PATCH /api/comments/[id] — author-only, 24h edit window
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest | Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Step 1: auth
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const { id } = await context.params

  const admin = createAdminSupabaseClient()

  // Step 2: load comment
  const { data: commentRow, error: commentFetchErr } = await admin
    .from('comments')
    .select('id, author_id, body, created_at, deleted_at')
    .eq('id', id)
    .single()

  if (commentFetchErr || !commentRow) {
    return json(404, { error: 'not_found' })
  }
  const comment = commentRow as CommentRow

  // Soft-deleted comments are not editable — treat as 404
  if (comment.deleted_at !== null) {
    return json(404, { error: 'not_found' })
  }

  // Step 3: author-only check — admins moderate via DELETE, not edit
  if (userId !== comment.author_id) {
    return json(403, { error: 'forbidden' })
  }

  // Step 4: 24h edit window (per v1 spec)
  if (Date.now() - new Date(comment.created_at).getTime() > EDIT_WINDOW_MS) {
    return json(403, { error: 'edit_window_expired' })
  }

  // Step 5: JSON parse
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // Step 6: Zod parse
  const parsed = CommentPatchBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }

  // Step 7: sanitize
  const sanitizedBody = sanitizeCommentBody(parsed.data.body)
  if (sanitizedBody.length === 0) {
    return json(400, { error: 'empty_body' })
  }

  // Step 8: update — post_id and parent_comment_id are immutable
  const editedAt = new Date().toISOString()
  const { error: updateErr } = await admin
    .from('comments')
    .update({ body: sanitizedBody, edited_at: editedAt })
    .eq('id', id)

  if (updateErr) {
    return json(500, { error: 'update_failed', detail: updateErr.message })
  }

  return json(200, { id, body: sanitizedBody, edited_at: editedAt })
}

// ---------------------------------------------------------------------------
// DELETE /api/comments/[id] — author OR admin (soft delete, body retained)
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest | Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Step 1: auth
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const { id } = await context.params

  const admin = createAdminSupabaseClient()

  // Step 2: load comment
  const { data: commentRow, error: commentFetchErr } = await admin
    .from('comments')
    .select('id, author_id, body, created_at, deleted_at')
    .eq('id', id)
    .single()

  if (commentFetchErr || !commentRow) {
    return json(404, { error: 'not_found' })
  }
  const comment = commentRow as CommentRow

  if (comment.deleted_at !== null) {
    return json(404, { error: 'not_found' })
  }

  // Step 3: author OR admin gate
  const isAuthor = userId === comment.author_id
  const isAdminUser = await resolveIsAdmin(userId)

  if (!isAuthor && !isAdminUser) {
    return json(403, { error: 'forbidden' })
  }

  // Step 4: parse optional reason from body (defensive — empty/invalid body is fine)
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
    // ignore — author self-delete commonly has no body
  }

  // Author takes precedence over admin (matches posts DELETE pattern)
  const deletion_reason: 'author' | 'moderation' = isAuthor ? 'author' : 'moderation'

  // Step 5: soft delete — body is retained for audit; render layer shows placeholder
  const { error: updateErr } = await admin
    .from('comments')
    .update({
      deleted_at: new Date().toISOString(),
      deletion_reason,
    })
    .eq('id', id)

  if (updateErr) {
    return json(500, { error: 'delete_failed', detail: updateErr.message })
  }

  // Step 6: if moderation delete, write a mod_actions audit row
  if (deletion_reason === 'moderation') {
    const { error: modErr } = await admin.from('mod_actions').insert({
      mod_user_id: userId,
      action: 'delete_comment',
      target_type: 'comment',
      target_id: String(id),
      reason,
      metadata: { author_id: comment.author_id },
    })
    if (modErr) {
      console.error('[mod_actions] insert failed:', modErr)
      // soft failure — deletion already succeeded, do not roll back
    }
  }

  return json(200, { ok: true, deletion_reason })
}
