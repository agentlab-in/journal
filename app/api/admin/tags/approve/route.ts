import { getSession } from '@/lib/auth'
import { requireAdminApi } from '@/lib/admin'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AdminTagApproveBody } from '@/lib/admin/schema'

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

  const parsed = AdminTagApproveBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: 'invalid_body', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) })
  }

  const { slug } = parsed.data

  const admin = createAdminSupabaseClient()

  // Lookup tag
  const { data: tagRow, error: tagFetchErr } = await admin
    .from('tags')
    .select('slug, is_approved')
    .eq('slug', slug)
    .maybeSingle()

  if (tagFetchErr || !tagRow) {
    return json(404, { error: 'tag_not_found' })
  }

  const tag = tagRow as { slug: string; is_approved: boolean }

  if (tag.is_approved) {
    return json(400, { error: 'already_approved' })
  }

  // Approve tag — also clear any rejection fields for cleanliness
  const { error: updateErr } = await admin
    .from('tags')
    .update({
      is_approved: true,
      approved_by: adminUserId,
      approved_at: new Date().toISOString(),
      rejected_at: null,
      rejected_by: null,
      rejected_reason: null,
    })
    .eq('slug', slug)

  if (updateErr) {
    return json(500, { error: 'approve_failed', detail: updateErr.message })
  }

  // Write mod_actions
  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: adminUserId,
    action: 'approve_tag',
    target_type: 'tag',
    target_id: slug,
    reason: null,
    metadata: {},
  })

  if (modErr) {
    console.error('[mod_actions] insert failed:', modErr)
  }

  return json(200, { ok: true })
}
