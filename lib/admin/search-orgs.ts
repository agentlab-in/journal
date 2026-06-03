import { createAdminSupabaseClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminOrgStatus = 'all' | 'active' | 'banned' | 'deleted'

export interface AdminOrgRow {
  id: string
  slug: string
  display_name: string
  created_at: string
  created_by_user_id: string
  created_by_username: string | null
  banned_at: string | null
  banned_reason: string | null
  deleted_at: string | null
  member_count: number
  post_count: number
}

interface SearchOrgsOptions {
  q?: string
  status?: AdminOrgStatus
  limit?: number
  offset?: number
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

export async function searchOrgs(
  opts: SearchOrgsOptions = {},
): Promise<AdminOrgRow[]> {
  const { q = '', status = 'all', limit = 20, offset = 0 } = opts

  const admin = createAdminSupabaseClient()

  // Build base query on orgs. Service role bypasses RLS so banned/deleted
  // orgs are visible to the admin console — that's the whole point.
  let query = admin
    .from('orgs')
    .select(
      'id, slug, display_name, created_at, created_by_user_id, banned_at, banned_reason, deleted_at',
    )

  if (q.trim().length > 0) {
    const escaped = q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)
    // ilike across slug OR display_name
    query = query.or(`slug.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
  }

  switch (status) {
    case 'active':
      query = query.is('banned_at', null).is('deleted_at', null)
      break
    case 'banned':
      query = query.not('banned_at', 'is', null)
      break
    case 'deleted':
      query = query.not('deleted_at', 'is', null)
      break
    case 'all':
    default:
      break
  }

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const { data, error } = await query

  if (error) {
    console.error('[admin/search-orgs] query error:', error)
    return []
  }

  const orgRows = (data ?? []) as Array<{
    id: string
    slug: string
    display_name: string
    created_at: string
    created_by_user_id: string
    banned_at: string | null
    banned_reason: string | null
    deleted_at: string | null
  }>

  if (orgRows.length === 0) return []

  // Resolve creator usernames
  const creatorIds = Array.from(
    new Set(orgRows.map((o) => o.created_by_user_id).filter(Boolean)),
  )
  const creatorMap = new Map<string, string>()

  if (creatorIds.length > 0) {
    const { data: creators } = await admin
      .from('users')
      .select('id, username')
      .in('id', creatorIds)

    for (const u of (creators ?? []) as Array<{ id: string; username: string }>) {
      creatorMap.set(u.id, u.username)
    }
  }

  // Batch-load member counts + post counts per org. Same pattern as
  // list-tags.ts — Supabase JS doesn't support GROUP BY, so issue a
  // count query per org. Capped at `limit` orgs per page, so this is fine.
  const memberCounts = new Map<string, number>()
  const postCounts = new Map<string, number>()

  await Promise.all(
    orgRows.map(async (org) => {
      const [members, posts] = await Promise.all([
        admin
          .from('org_members')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', org.id),
        admin
          .from('posts')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', org.id)
          .is('deleted_at', null),
      ])
      memberCounts.set(org.id, members.count ?? 0)
      postCounts.set(org.id, posts.count ?? 0)
    }),
  )

  return orgRows.map((o) => ({
    id: o.id,
    slug: o.slug,
    display_name: o.display_name,
    created_at: o.created_at,
    created_by_user_id: o.created_by_user_id,
    created_by_username: creatorMap.get(o.created_by_user_id) ?? null,
    banned_at: o.banned_at,
    banned_reason: o.banned_reason,
    deleted_at: o.deleted_at,
    member_count: memberCounts.get(o.id) ?? 0,
    post_count: postCounts.get(o.id) ?? 0,
  }))
}
