import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { CommentCreateBody } from '@/lib/comments/schema'
import { sanitizeCommentBody } from '@/lib/comments/sanitize'
import { getNewCommentDepth } from '@/lib/comments/depth'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const MAX_DEPTH = 5

export async function POST(req: NextRequest | Request): Promise<Response> {
  // Step 1: auth
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  // Step 2: JSON parse
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // Step 3: Zod parse
  const parsed = CommentCreateBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }

  const { post_id, parent_comment_id, body } = parsed.data

  // Step 4: sanitize body — empty after strip means there was no real content
  const sanitizedBody = sanitizeCommentBody(body)
  if (sanitizedBody.length === 0) {
    return json(400, { error: 'empty_body' })
  }

  const admin = createAdminSupabaseClient()

  // Step 5: verify post exists and is not soft-deleted
  const { data: postRow, error: postFetchErr } = await admin
    .from('posts')
    .select('id, deleted_at')
    .eq('id', post_id)
    .single()

  if (postFetchErr || !postRow) {
    return json(404, { error: 'post_not_found' })
  }
  const post = postRow as { id: string; deleted_at: string | null }
  if (post.deleted_at !== null) {
    return json(404, { error: 'post_not_found' })
  }

  // Step 6: if parent_comment_id, verify it exists, same post, not deleted
  if (parent_comment_id) {
    const { data: parentRow, error: parentFetchErr } = await admin
      .from('comments')
      .select('id, post_id, deleted_at')
      .eq('id', parent_comment_id)
      .single()

    if (parentFetchErr || !parentRow) {
      return json(400, { error: 'parent_not_found' })
    }
    const parent = parentRow as {
      id: string
      post_id: string
      deleted_at: string | null
    }
    if (parent.post_id !== post_id || parent.deleted_at !== null) {
      return json(400, { error: 'parent_not_found' })
    }
  }

  // Step 7: compute depth via RPC-backed helper; reject if > MAX_DEPTH
  const depth = await getNewCommentDepth(admin, parent_comment_id ?? null)
  if (depth > MAX_DEPTH) {
    return json(400, { error: 'depth_exceeded', max: MAX_DEPTH })
  }

  // Step 8: insert row
  const { data: inserted, error: insertErr } = await admin
    .from('comments')
    .insert({
      post_id,
      author_id: userId,
      parent_comment_id: parent_comment_id ?? null,
      body: sanitizedBody,
    })
    .select('id, post_id, parent_comment_id, body, author_id, created_at')
    .single()

  if (insertErr || !inserted) {
    return json(500, { error: 'insert_failed', detail: insertErr?.message })
  }

  // TODO(Phase 10): notification fan-out hooks here — emit to post author on root, to parent commenter on reply (skip if self).

  const row = inserted as {
    id: string
    post_id: string
    parent_comment_id: string | null
    body: string
    author_id: string
    created_at: string
  }

  return json(201, {
    id: row.id,
    post_id: row.post_id,
    parent_comment_id: row.parent_comment_id,
    body: row.body,
    author_id: row.author_id,
    created_at: row.created_at,
  })
}
