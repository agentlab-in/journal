import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { OrgUpdateBody } from '@/lib/orgs/schema'
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
// PATCH /api/orgs/[slug] — update org profile
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest | Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const guard = await guardMutatingRequest(req, {
    bucket: 'edit_org',
    userId,
  })
  if (guard.failed) return guard.response

  const { slug } = await context.params
  const admin = createAdminSupabaseClient()

  const org = await getOrgBySlug(admin, slug)
  if (!org) return json(404, { error: 'not_found' })

  const gate = await requireOrgAdmin(admin, org.id, userId)
  if (gate) return gate

  // Parse body
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // Slug is immutable — reject if present in body, BEFORE strict Zod parse
  // gives a less helpful error.
  if (raw && typeof raw === 'object' && 'slug' in (raw as object)) {
    return json(400, { error: 'slug_immutable' })
  }

  const parsed = OrgUpdateBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }

  const { display_name, bio, avatar_url, cover_image_url } = parsed.data

  // Build update payload. Empty-string bio → NULL (explicit clear); undefined
  // means "no change". null for images means explicit clear; undefined means
  // "no change".
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (display_name !== undefined) update.display_name = display_name
  if (bio !== undefined) update.bio = bio === '' ? null : bio
  if (avatar_url !== undefined) update.avatar_url = avatar_url
  if (cover_image_url !== undefined) update.cover_image_url = cover_image_url

  const { data: updatedRow, error: updateErr } = await admin
    .from('orgs')
    .update(update)
    .eq('id', org.id)
    .select(
      'id, slug, display_name, bio, avatar_url, cover_image_url, updated_at',
    )
    .single()

  if (updateErr || !updatedRow) {
    logRouteError(updateErr, {
      route: '/api/orgs/[slug]',
      userId,
      extra: { op: 'orgs_update', orgId: org.id },
    })
    return json(500, { error: 'update_failed', detail: updateErr?.message })
  }

  return json(200, updatedRow as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// DELETE /api/orgs/[slug] — soft-delete org
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest | Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const guard = await guardMutatingRequest(req, {
    bucket: 'delete_org',
    userId,
  })
  if (guard.failed) return guard.response

  const { slug } = await context.params
  const admin = createAdminSupabaseClient()

  const org = await getOrgBySlug(admin, slug)
  if (!org) return json(404, { error: 'not_found' })

  const gate = await requireOrgAdmin(admin, org.id, userId)
  if (gate) return gate

  const deleted_at = new Date().toISOString()
  const { error: updateErr } = await admin
    .from('orgs')
    .update({ deleted_at })
    .eq('id', org.id)

  if (updateErr) {
    logRouteError(updateErr, {
      route: '/api/orgs/[slug]',
      userId,
      extra: { op: 'orgs_soft_delete', orgId: org.id },
    })
    return json(500, { error: 'delete_failed', detail: updateErr.message })
  }

  // Audit row — keep parity with admin moderation flows.
  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: userId,
    action: 'delete_org',
    target_type: 'org',
    target_id: org.id,
    reason: null,
    metadata: { slug: org.slug, display_name: org.display_name },
  })
  if (modErr) {
    logRouteError(modErr, {
      route: '/api/orgs/[slug]',
      userId,
      extra: { op: 'mod_actions_insert', orgId: org.id },
    })
    // soft failure — soft-delete already succeeded.
  }

  return json(200, { id: org.id, slug: org.slug, deleted_at })
}
