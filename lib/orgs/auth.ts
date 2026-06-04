// ---------------------------------------------------------------------------
// Phase 11.5 — Org lookup + membership helpers.
//
// GitHub-backed orgs: rows + memberships are materialized by the sync layer
// (lib/orgs/github-sync.ts), so this module only carries read-side helpers
// used by routing, the profile-settings page, and the editor's publish-as
// gate. There is no admin-vs-member tier on agentlab itself, so the old
// requireOrgAdmin / isOrgAdmin helpers were removed alongside the write
// routes they gated.
// ---------------------------------------------------------------------------
import type { SupabaseClient } from '@supabase/supabase-js'

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
 * Returns true iff `userId` is a member of `orgId`. Used by the editor's
 * publish-as gate so authors can only attribute posts to orgs they belong
 * to. The sync layer is the sole writer of `org_members`.
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

/**
 * Resolve an org by id. Returns null if no row exists OR the row is
 * soft-deleted / banned — callers should 404 in all three cases for parity
 * with the public-read RLS policy and getOrgBySlug.
 */
export async function getActiveOrgById(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  orgId: string,
): Promise<{ id: string; slug: string } | null> {
  const { data, error } = await supabase
    .from('orgs')
    .select('id, slug, deleted_at, banned_at')
    .eq('id', orgId)
    .maybeSingle()

  if (error || !data) return null
  const row = data as {
    id: string
    slug: string
    deleted_at: string | null
    banned_at: string | null
  }
  if (row.deleted_at !== null || row.banned_at !== null) return null
  return { id: row.id, slug: row.slug }
}
