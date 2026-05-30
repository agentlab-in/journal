import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { guardMutatingRequest } from '@/lib/route-guard'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function DELETE(
  req: NextRequest | Request,
  context: { params: Promise<{ postId: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  // Origin guard only — pin remove isn't in the bucket list.
  const guard = await guardMutatingRequest(req, { userId })
  if (guard.failed) return guard.response

  const { postId } = await context.params

  const admin = createAdminSupabaseClient()

  // Existence check scoped to the caller so unrelated rows can't leak via 404.
  const { data: pinRow, error: lookupErr } = await admin
    .from('pinned_posts')
    .select('post_id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle()

  if (lookupErr) {
    return json(500, { error: 'pin_lookup_failed', detail: lookupErr.message })
  }
  if (!pinRow) {
    return json(404, { error: 'pin_not_found' })
  }

  const { error: deleteErr } = await admin
    .from('pinned_posts')
    .delete()
    .eq('user_id', userId)
    .eq('post_id', postId)

  if (deleteErr) {
    return json(500, { error: 'pin_delete_failed', detail: deleteErr.message })
  }

  return new Response(null, { status: 204 })
}
