import { createAdminSupabaseClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingTagRow {
  slug: string
  name: string
  usage_count: number
  created_at: string
}

interface ListPendingTagsOptions {
  cursor?: string | null // ISO created_at of last row on previous page
  limit?: number
}

// ---------------------------------------------------------------------------
// Main list function
// ---------------------------------------------------------------------------

export async function listPendingTags(
  opts: ListPendingTagsOptions = {},
): Promise<{ rows: PendingTagRow[]; nextCursor: string | null }> {
  const { cursor, limit = 25 } = opts

  const admin = createAdminSupabaseClient()

  // Pending = not approved AND not rejected
  let query = admin
    .from('tags')
    .select('slug, name, created_at')
    .eq('is_approved', false)
    .is('rejected_at', null)
    .order('created_at', { ascending: false })
    .limit(limit + 1)

  if (cursor) {
    query = query.lt('created_at', cursor)
  }

  const { data, error } = await query

  if (error) {
    console.error('[admin/list-tags] query error:', error)
    return { rows: [], nextCursor: null }
  }

  const raw = (data ?? []) as Array<{
    slug: string
    name: string
    created_at: string
  }>

  const hasMore = raw.length > limit
  const rows = hasMore ? raw.slice(0, limit) : raw
  const nextCursor = hasMore ? (rows[rows.length - 1]?.created_at ?? null) : null

  // Batch-load usage counts via separate query for each slug
  const slugs = rows.map((r) => r.slug)
  const usageMap = new Map<string, number>()

  if (slugs.length > 0) {
    // post_tags has (post_id, tag_slug) — count per slug
    // Supabase doesn't support GROUP BY via the JS client, so we do individual counts.
    // For the typical admin workload (< 25 pending tags at once) this is fine.
    await Promise.all(
      slugs.map(async (slug) => {
        const { count } = await admin
          .from('post_tags')
          .select('*', { count: 'exact', head: true })
          .eq('tag_slug', slug)
        usageMap.set(slug, count ?? 0)
      }),
    )
  }

  const enrichedRows: PendingTagRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    usage_count: usageMap.get(r.slug) ?? 0,
    created_at: r.created_at,
  }))

  return { rows: enrichedRows, nextCursor }
}
