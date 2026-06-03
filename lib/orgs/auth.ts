// ---------------------------------------------------------------------------
// Phase 11 — Org-membership API gates.
//
// Mirrors lib/admin.ts: provides a Response-returning helper that route
// handlers can short-circuit with, so handler bodies stay flat.
// ---------------------------------------------------------------------------
import type { SupabaseClient } from '@supabase/supabase-js'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface OrgRow {
  id: string
  slug: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  cover_image_url: string | null
  created_at: string
  updated_at: string
  created_by_user_id: string
  deleted_at: string | null
  banned_at: string | null
}

/**
 * Resolve an org by slug. Returns null if no row exists OR the row is
 * soft-deleted / banned — callers should 404 in all three cases for parity
 * with the public-read RLS policy.
 */
export async function getOrgBySlug(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  slug: string,
): Promise<OrgRow | null> {
  const { data, error } = await supabase
    .from('orgs')
    .select(
      'id, slug, display_name, bio, avatar_url, cover_image_url, created_at, updated_at, created_by_user_id, deleted_at, banned_at',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) return null
  const row = data as OrgRow
  if (row.deleted_at !== null || row.banned_at !== null) return null
  return row
}

/**
 * Returns `null` when `userId` is an admin of `orgId`, or a 403 Response
 * (404 if no row exists) otherwise. Modeled after `requireAdminApi`.
 */
export async function requireOrgAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  orgId: string,
  userId: string,
): Promise<Response | null> {
  const { data, error } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) {
    return json(403, { error: 'forbidden' })
  }
  const row = data as { role: string }
  if (row.role !== 'admin') {
    return json(403, { error: 'forbidden' })
  }
  return null
}

/**
 * Returns true iff `userId` is a member (any role) of `orgId`. Used by the
 * member-remove endpoint to support self-removal without admin rights.
 */
export async function isOrgMember(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  return Boolean(data)
}
