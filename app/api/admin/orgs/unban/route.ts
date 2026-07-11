import { getSession } from '@/lib/auth'
import { requireAdminApi } from '@/lib/admin'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AdminOrgUnbanBody } from '@/lib/admin/schema'
import { guardMutatingRequest } from '@/lib/route-guard'
import { logRouteError } from '@/lib/logging/error-log'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession()
  const gate = await requireAdminApi(session)
  if (gate) return gate
  const adminUserId = session!.user.id

  const guard = await guardMutatingRequest(req, { userId: adminUserId })
  if (guard.failed) return guard.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_body' })
  }

  const parsed = AdminOrgUnbanBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }

  const { org_id } = parsed.data

  const admin = createAdminSupabaseClient()

  const { data: orgRow, error: orgFetchErr } = await admin
    .from('orgs')
    .select('id, slug, banned_at')
    .eq('id', org_id)
    .maybeSingle()

  if (orgFetchErr || !orgRow) {
    return json(404, { error: 'org_not_found' })
  }

  const org = orgRow as { id: string; slug: string; banned_at: string | null }

  if (org.banned_at === null) {
    return json(400, { error: 'not_banned' })
  }

  const { error: unbanErr } = await admin
    .from('orgs')
    .update({
      banned_at: null,
      banned_reason: null,
      banned_by: null,
    })
    .eq('id', org_id)

  if (unbanErr) {
    return json(500, { error: 'unban_failed', detail: unbanErr.message })
  }

  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: adminUserId,
    action: 'unban_org',
    target_type: 'org',
    target_id: org_id,
    reason: null,
    metadata: { slug: org.slug },
  })

  if (modErr) {
    logRouteError(modErr, {
      route: '/api/admin/orgs/unban',
      userId: adminUserId,
      extra: { op: 'mod_actions_insert', target_org_id: org_id },
    })
  }

  return json(200, { id: org.id, slug: org.slug })
}
