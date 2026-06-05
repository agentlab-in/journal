import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { ReportCreateBody } from '@/lib/reports/schema'
import { guardMutatingRequest } from '@/lib/route-guard'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: NextRequest | Request): Promise<Response> {
  // Step 1: auth
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const reporterId = session.user.id

  // Step 1b: origin + report-bucket rate-limit (Phase 14)
  const guard = await guardMutatingRequest(req, { bucket: 'report', userId: reporterId, requireConsent: true })
  if (guard.failed) return guard.response

  // Step 2: JSON parse
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // Step 3: Zod parse
  const parsed = ReportCreateBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }

  const { target_type, target_id, reason } = parsed.data

  const admin = createAdminSupabaseClient()

  // Step 4: Self-report check + existence check
  if (target_type === 'user') {
    // Check self-report
    if (target_id === reporterId) {
      return json(400, { error: 'self_report' })
    }

    // Existence check
    const { data: userRow, error: userErr } = await admin
      .from('users')
      .select('id')
      .eq('id', target_id)
      .maybeSingle()

    if (userErr || !userRow) {
      return json(404, { error: 'target_not_found' })
    }
  } else if (target_type === 'post') {
    // Existence check (soft-deleted posts still exist)
    const { data: postRow, error: postErr } = await admin
      .from('posts')
      .select('id, author_id')
      .eq('id', target_id)
      .maybeSingle()

    if (postErr || !postRow) {
      return json(404, { error: 'target_not_found' })
    }

    // Self-report check
    const post = postRow as { id: string; author_id: string }
    if (post.author_id === reporterId) {
      return json(400, { error: 'self_report' })
    }
  } else if (target_type === 'comment') {
    // Existence check (soft-deleted comments still exist)
    const { data: commentRow, error: commentErr } = await admin
      .from('comments')
      .select('id, author_id')
      .eq('id', target_id)
      .maybeSingle()

    if (commentErr || !commentRow) {
      return json(404, { error: 'target_not_found' })
    }

    // Self-report check
    const comment = commentRow as { id: string; author_id: string }
    if (comment.author_id === reporterId) {
      return json(400, { error: 'self_report' })
    }
  }

  // Step 5: Dedup — check for existing unresolved report from this reporter
  const { data: dupRow } = await admin
    .from('reports')
    .select('id')
    .eq('reporter_id', reporterId)
    .eq('target_type', target_type)
    .eq('target_id', target_id)
    .is('resolved_at', null)
    .maybeSingle()

  if (dupRow) {
    return json(400, { error: 'duplicate_report' })
  }

  // Step 6: Insert report
  const { data: reportRow, error: insertErr } = await admin
    .from('reports')
    .insert({
      reporter_id: reporterId,
      target_type,
      target_id,
      reason,
    })
    .select('id')
    .single()

  if (insertErr || !reportRow) {
    return json(500, { error: 'insert_failed', detail: insertErr?.message })
  }

  return json(201, { id: (reportRow as { id: string }).id })
}
