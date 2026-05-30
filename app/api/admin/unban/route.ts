import { getSession } from '@/lib/auth'
import { requireAdminApi } from '@/lib/admin'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AdminUnbanBody } from '@/lib/admin/schema'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession()
  const gate = await requireAdminApi(session)
  if (gate) return gate
  const adminUserId = session!.user.id

  // Parse body
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_body' })
  }

  const parsed = AdminUnbanBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: 'invalid_body', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) })
  }

  const { user_id } = parsed.data

  const admin = createAdminSupabaseClient()

  // Lookup target user
  const { data: userRow, error: userFetchErr } = await admin
    .from('users')
    .select('id, username, banned_at')
    .eq('id', user_id)
    .maybeSingle()

  if (userFetchErr || !userRow) {
    return json(404, { error: 'user_not_found' })
  }

  const user = userRow as { id: string; username: string; banned_at: string | null }

  if (user.banned_at === null) {
    return json(400, { error: 'not_banned' })
  }

  // Unban the user
  const { error: unbanErr } = await admin
    .from('users')
    .update({
      banned_at: null,
      banned_reason: null,
      banned_by: null,
    })
    .eq('id', user_id)

  if (unbanErr) {
    return json(500, { error: 'unban_failed', detail: unbanErr.message })
  }

  // Write mod_actions
  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: adminUserId,
    action: 'unban_user',
    target_type: 'user',
    target_id: user_id,
    reason: null,
    metadata: { username: user.username },
  })

  if (modErr) {
    console.error('[mod_actions] insert failed:', modErr)
  }

  return json(200, { ok: true })
}
