import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { OrgMemberAddBody } from '@/lib/orgs/schema'
import { getOrgBySlug, requireOrgAdmin } from '@/lib/orgs/auth'
import { guardMutatingRequest } from '@/lib/route-guard'
import { logRouteError } from '@/lib/logging/error-log'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// POST /api/orgs/[slug]/members — add member
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest | Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const guard = await guardMutatingRequest(req, {
    bucket: 'edit_org_members',
    userId,
  })
  if (guard.failed) return guard.response

  const { slug } = await context.params
  const admin = createAdminSupabaseClient()

  const org = await getOrgBySlug(admin, slug)
  if (!org) return json(404, { error: 'not_found' })

  const gate = await requireOrgAdmin(admin, org.id, userId)
  if (gate) return gate

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const parsed = OrgMemberAddBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }
  const { username, role } = parsed.data

  // Resolve username → user_id
  const { data: userRow } = await admin
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  if (!userRow) {
    return json(404, { error: 'user_not_found' })
  }
  const targetUserId = (userRow as { id: string }).id

  // Check already-member
  const { data: existing } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', org.id)
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (existing) {
    return json(409, { error: 'already_member' })
  }

  const added_at = new Date().toISOString()
  const { error: insertErr } = await admin.from('org_members').insert({
    org_id: org.id,
    user_id: targetUserId,
    role,
    added_at,
    added_by_user_id: userId,
  })

  if (insertErr) {
    // Race-window unique violation → 409 already_member.
    const code = (insertErr as { code?: string }).code
    if (code === '23505') {
      return json(409, { error: 'already_member' })
    }
    logRouteError(insertErr, {
      route: '/api/orgs/[slug]/members',
      userId,
      extra: { op: 'org_members_insert', orgId: org.id, targetUserId },
    })
    return json(500, {
      error: 'org_members_insert_failed',
      detail: insertErr.message,
    })
  }

  return json(201, {
    org_id: org.id,
    user_id: targetUserId,
    role,
    added_at,
  })
}
