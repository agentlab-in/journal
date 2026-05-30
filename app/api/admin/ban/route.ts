import { getSession } from '@/lib/auth'
import { requireAdminApi } from '@/lib/admin'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AdminBanBody } from '@/lib/admin/schema'

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

  const parsed = AdminBanBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: 'invalid_body', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) })
  }

  const { user_id, reason } = parsed.data

  // Self-ban check
  if (user_id === adminUserId) {
    return json(400, { error: 'self_action' })
  }

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

  if (user.banned_at !== null) {
    return json(400, { error: 'already_banned' })
  }

  // Ban the user
  const { error: banErr } = await admin
    .from('users')
    .update({
      banned_at: new Date().toISOString(),
      banned_reason: reason,
      banned_by: adminUserId,
    })
    .eq('id', user_id)

  if (banErr) {
    return json(500, { error: 'ban_failed', detail: banErr.message })
  }

  // Delete sessions from next_auth.sessions
  const { data: deletedSessions, error: sessionsErr } = await admin
    .schema('next_auth')
    .from('sessions')
    .delete()
    .eq('"userId"', user_id)
    .select('id')

  if (sessionsErr) {
    console.error('[admin/ban] sessions delete failed:', sessionsErr)
  }

  const sessions_deleted = deletedSessions ? (deletedSessions as unknown[]).length : 0

  // Write mod_actions
  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: adminUserId,
    action: 'ban_user',
    target_type: 'user',
    target_id: user_id,
    reason,
    metadata: { username: user.username, sessions_deleted },
  })

  if (modErr) {
    console.error('[mod_actions] insert failed:', modErr)
  }

  return json(200, { ok: true })
}
