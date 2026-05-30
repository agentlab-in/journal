import { getSession } from '@/lib/auth'
import { requireAdminApi } from '@/lib/admin'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AdminTagRejectBody } from '@/lib/admin/schema'

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

  const parsed = AdminTagRejectBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: 'invalid_body', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) })
  }

  const { slug, reason } = parsed.data

  const admin = createAdminSupabaseClient()

  // Lookup tag
  const { data: tagRow, error: tagFetchErr } = await admin
    .from('tags')
    .select('slug, rejected_at')
    .eq('slug', slug)
    .maybeSingle()

  if (tagFetchErr || !tagRow) {
    return json(404, { error: 'tag_not_found' })
  }

  const tag = tagRow as { slug: string; rejected_at: string | null }

  if (tag.rejected_at !== null) {
    return json(400, { error: 'already_rejected' })
  }

  // Soft-reject — leave is_approved unchanged (false), set rejection fields
  const { error: updateErr } = await admin
    .from('tags')
    .update({
      rejected_at: new Date().toISOString(),
      rejected_by: adminUserId,
      rejected_reason: reason,
    })
    .eq('slug', slug)

  if (updateErr) {
    return json(500, { error: 'reject_failed', detail: updateErr.message })
  }

  // Write mod_actions
  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: adminUserId,
    action: 'reject_tag',
    target_type: 'tag',
    target_id: slug,
    reason,
    metadata: {},
  })

  if (modErr) {
    console.error('[mod_actions] insert failed:', modErr)
  }

  return json(200, { ok: true })
}
