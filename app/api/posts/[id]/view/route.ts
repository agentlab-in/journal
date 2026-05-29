import type { NextRequest } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

// ---------------------------------------------------------------------------
// POST /api/posts/[id]/view
//
// Fire-and-forget view-count beacon. Atomically increments posts.view_count
// for the given id (only when deleted_at IS NULL). Always returns 204 — even
// when the post doesn't exist — so the response never leaks post existence.
// No auth required: anonymous view counts are intentional.
// ---------------------------------------------------------------------------

export async function POST(
  _req: NextRequest | Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  const admin = createAdminSupabaseClient()

  // Atomically increment via a SECURITY DEFINER RPC (see migration 0004).
  // We intentionally swallow errors: the beacon must never surface DB issues
  // or reveal whether a post exists.
  await admin.rpc('increment_post_view_count', { p_id: id })

  return new Response(null, { status: 204 })
}
