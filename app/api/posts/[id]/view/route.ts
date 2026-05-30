import type { NextRequest } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { guardMutatingRequest } from '@/lib/route-guard'

export const runtime = 'nodejs'

// ---------------------------------------------------------------------------
// POST /api/posts/[id]/view
//
// Fire-and-forget view-count beacon. Atomically increments posts.view_count
// for the given id (only when deleted_at IS NULL). Always returns 204 — even
// when the post doesn't exist — so the response never leaks post existence.
// No auth required: anonymous view counts are intentional.
//
// Origin-only guard (Phase 14): no app-level rate limit (view spam is
// already filtered by the once-per-session beacon in the client and would
// require IP buckets we don't have here).
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest | Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await guardMutatingRequest(req, {})
  if (guard.failed) return guard.response

  const { id } = await context.params

  const admin = createAdminSupabaseClient()

  // Atomically increment via a SECURITY DEFINER RPC (see migration 0004).
  // We intentionally swallow errors: the beacon must never surface DB issues
  // or reveal whether a post exists.
  await admin.rpc('increment_post_view_count', { p_id: id })

  return new Response(null, { status: 204 })
}
