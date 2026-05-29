import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { MAX_PINS, PinCreateBody, nextPosition } from '@/lib/profile/pin'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: NextRequest | Request): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const parsed = PinCreateBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }

  const { post_id, position } = parsed.data
  const admin = createAdminSupabaseClient()

  // Ownership + existence + soft-delete check on the post.
  const { data: postRow, error: postErr } = await admin
    .from('posts')
    .select('author_id, deleted_at')
    .eq('id', post_id)
    .single()

  if (postErr || !postRow) {
    return json(404, { error: 'post_not_found' })
  }
  const post = postRow as { author_id: string; deleted_at: string | null }
  if (post.deleted_at !== null) {
    return json(404, { error: 'post_not_found' })
  }
  if (post.author_id !== userId) {
    return json(403, { error: 'not_owner' })
  }

  // Already-pinned check (PK is (user_id, post_id); maybeSingle returns null
  // when no row matches, which is the expected happy-path branch).
  const { data: existingPin, error: existingErr } = await admin
    .from('pinned_posts')
    .select('post_id')
    .eq('user_id', userId)
    .eq('post_id', post_id)
    .maybeSingle()

  if (existingErr) {
    return json(500, { error: 'pin_lookup_failed', detail: existingErr.message })
  }
  if (existingPin) {
    return json(409, { error: 'already_pinned' })
  }

  // Pin-limit check + position derivation share the same fetch.
  const { data: positionRows, error: positionsErr } = await admin
    .from('pinned_posts')
    .select('position')
    .eq('user_id', userId)

  if (positionsErr) {
    return json(500, {
      error: 'pin_positions_failed',
      detail: positionsErr.message,
    })
  }

  const existingPositions = ((positionRows ?? []) as Array<{ position: number }>).map(
    (r) => r.position,
  )
  if (existingPositions.length >= MAX_PINS) {
    return json(409, { error: 'pin_limit_reached' })
  }

  const finalPosition = position ?? nextPosition(existingPositions)

  const { data: insertedRow, error: insertErr } = await admin
    .from('pinned_posts')
    .insert({ user_id: userId, post_id, position: finalPosition })
    .select('user_id, post_id, position')
    .single()

  if (insertErr || !insertedRow) {
    return json(500, { error: 'pin_insert_failed', detail: insertErr?.message })
  }

  return json(201, insertedRow as Record<string, unknown>)
}
