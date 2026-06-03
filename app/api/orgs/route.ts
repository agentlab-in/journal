import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { OrgCreateBody } from '@/lib/orgs/schema'
import { checkSlugCollision } from '@/lib/slug-collisions'
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
// POST /api/orgs — create org
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest | Request): Promise<Response> {
  // Step 1: auth
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  // Step 1b: origin + rate-limit guard
  const guard = await guardMutatingRequest(req, {
    bucket: 'create_org',
    userId,
  })
  if (guard.failed) return guard.response

  // Step 2: JSON parse
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // Step 3: Zod parse
  const parsed = OrgCreateBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }
  const { slug, display_name, bio } = parsed.data

  // Step 4: cross-table slug collision check (reserved / username / org slug)
  const collision = await checkSlugCollision(slug)
  if (collision !== null) {
    return json(409, { error: 'slug_taken', reason: collision })
  }

  const admin = createAdminSupabaseClient()

  // Step 5: insert orgs row
  const { data: orgRow, error: orgInsertErr } = await admin
    .from('orgs')
    .insert({
      slug,
      display_name,
      bio: bio ?? null,
      created_by_user_id: userId,
    })
    .select('id, slug, display_name')
    .single()

  if (orgInsertErr || !orgRow) {
    // Unique violation on slug — TOCTOU race with another writer.
    // Postgres unique violation is SQLSTATE 23505.
    // PostgrestError carries this in `.code`.
    const code = (orgInsertErr as { code?: string } | null)?.code
    if (code === '23505') {
      return json(409, { error: 'slug_taken', reason: 'org_slug_taken' })
    }
    logRouteError(orgInsertErr, {
      route: '/api/orgs',
      userId,
      extra: { op: 'orgs_insert', slug },
    })
    return json(500, {
      error: 'org_insert_failed',
      detail: orgInsertErr?.message,
    })
  }

  const org = orgRow as { id: string; slug: string; display_name: string }

  // Step 6: insert first org_members row (admin, self)
  const { error: memberInsertErr } = await admin.from('org_members').insert({
    org_id: org.id,
    user_id: userId,
    role: 'admin',
    added_by_user_id: userId,
  })

  if (memberInsertErr) {
    logRouteError(memberInsertErr, {
      route: '/api/orgs',
      userId,
      extra: { op: 'org_members_insert', orgId: org.id },
    })
    // Best-effort cleanup: remove the orphan orgs row so we don't leave an
    // org with no admin member. If this delete fails too, log it but still
    // return the original 500 so the client gets a stable error shape.
    const { error: cleanupErr } = await admin
      .from('orgs')
      .delete()
      .eq('id', org.id)
    if (cleanupErr) {
      logRouteError(cleanupErr, {
        route: '/api/orgs',
        userId,
        extra: { op: 'orgs_orphan_cleanup', orgId: org.id },
      })
    }
    return json(500, {
      error: 'org_members_insert_failed',
      detail: memberInsertErr.message,
    })
  }

  return json(201, {
    id: org.id,
    slug: org.slug,
    display_name: org.display_name,
  })
}
