import { getSession } from '@/lib/auth'
import { requireAdminApi } from '@/lib/admin'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AdminReportResolveBody } from '@/lib/admin/schema'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession()
  const gate = await requireAdminApi(session)
  if (gate) return gate
  const adminUserId = session!.user.id

  const { id: reportId } = await context.params

  // Parse body
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_body' })
  }

  const parsed = AdminReportResolveBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: 'invalid_body', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) })
  }

  const { resolution, notes } = parsed.data

  const admin = createAdminSupabaseClient()

  // Lookup report
  const { data: reportRow, error: reportFetchErr } = await admin
    .from('reports')
    .select('id, resolved_at, target_type, target_id')
    .eq('id', reportId)
    .maybeSingle()

  if (reportFetchErr || !reportRow) {
    return json(404, { error: 'report_not_found' })
  }

  const report = reportRow as {
    id: string
    resolved_at: string | null
    target_type: string
    target_id: string
  }

  if (report.resolved_at !== null) {
    return json(400, { error: 'already_resolved' })
  }

  // Resolve the report
  const { error: updateErr } = await admin
    .from('reports')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: adminUserId,
      resolution,
      notes: notes ?? null,
    })
    .eq('id', reportId)

  if (updateErr) {
    return json(500, { error: 'resolve_failed', detail: updateErr.message })
  }

  // Write mod_actions
  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: adminUserId,
    action: 'resolve_report',
    target_type: 'report',
    target_id: reportId,
    reason: notes ?? null,
    metadata: {
      resolution,
      original_target_type: report.target_type,
      original_target_id: report.target_id,
    },
  })

  if (modErr) {
    console.error('[mod_actions] insert failed:', modErr)
  }

  return json(200, { ok: true })
}
