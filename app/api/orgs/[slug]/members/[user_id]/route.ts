import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { OrgMemberRoleBody } from '@/lib/orgs/schema'
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

// The zero-admin trigger raises EXCEPTION with the literal substring
// `org_members_prevent_zero_admins` and ERRCODE `check_violation` (SQLSTATE
// 23514). Match either the code or the message so we surface a clear 409.
function isZeroAdminError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === '23514') return true
  return (err.message ?? '').includes('org_members_prevent_zero_admins')
}

// ---------------------------------------------------------------------------
// PATCH /api/orgs/[slug]/members/[user_id] — change role
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest | Request,
  context: { params: Promise<{ slug: string; user_id: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const guard = await guardMutatingRequest(req, {
    bucket: 'edit_org_members',
    userId,
  })
  if (guard.failed) return guard.response

  const { slug, user_id: targetUserId } = await context.params
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

  const parsed = OrgMemberRoleBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }
  const { role } = parsed.data

  // Membership existence check — 404 if not a member.
  const { data: memberRow } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', org.id)
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (!memberRow) {
    return json(404, { error: 'not_member' })
  }

  const { error: updateErr } = await admin
    .from('org_members')
    .update({ role })
    .eq('org_id', org.id)
    .eq('user_id', targetUserId)

  if (updateErr) {
    if (
      isZeroAdminError(
        updateErr as unknown as { code?: string; message?: string },
      )
    ) {
      return json(409, { error: 'last_admin' })
    }
    logRouteError(updateErr, {
      route: '/api/orgs/[slug]/members/[user_id]',
      userId,
      extra: { op: 'org_members_update', orgId: org.id, targetUserId },
    })
    return json(500, { error: 'update_failed', detail: updateErr.message })
  }

  return json(200, { org_id: org.id, user_id: targetUserId, role })
}

// ---------------------------------------------------------------------------
// DELETE /api/orgs/[slug]/members/[user_id] — remove member / leave
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest | Request,
  context: { params: Promise<{ slug: string; user_id: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const guard = await guardMutatingRequest(req, {
    bucket: 'edit_org_members',
    userId,
  })
  if (guard.failed) return guard.response

  const { slug, user_id: targetUserId } = await context.params
  const admin = createAdminSupabaseClient()

  const org = await getOrgBySlug(admin, slug)
  if (!org) return json(404, { error: 'not_found' })

  // Authz: caller is admin OR removing self.
  const isSelf = userId === targetUserId
  if (!isSelf) {
    const gate = await requireOrgAdmin(admin, org.id, userId)
    if (gate) return gate
  }

  // Confirm the target is actually a member (so 404 vs 200 stays honest).
  const { data: memberRow } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', org.id)
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (!memberRow) {
    return json(404, { error: 'not_member' })
  }

  const { error: deleteErr } = await admin
    .from('org_members')
    .delete()
    .eq('org_id', org.id)
    .eq('user_id', targetUserId)

  if (deleteErr) {
    if (
      isZeroAdminError(
        deleteErr as unknown as { code?: string; message?: string },
      )
    ) {
      return json(409, { error: 'last_admin' })
    }
    logRouteError(deleteErr, {
      route: '/api/orgs/[slug]/members/[user_id]',
      userId,
      extra: { op: 'org_members_delete', orgId: org.id, targetUserId },
    })
    return json(500, { error: 'delete_failed', detail: deleteErr.message })
  }

  return json(200, { org_id: org.id, user_id: targetUserId })
}
