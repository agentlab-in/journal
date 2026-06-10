/**
 * getTrendingTags — viewer-agnostic trending-tag signal for the home
 * sidebar rail.
 *
 * Counts how many approved, non-deleted posts used each tag within a
 * rolling `windowDays` window, then returns the top `limit` tags sorted
 * by count descending.
 *
 * Implementation notes:
 *   - The join fan-out (post_tags → tags → posts) is resolved in a single
 *     PostgREST round-trip; counting is done in-memory (a Map) so we avoid
 *     an additional GROUP BY query. For the default window/limit the
 *     result set is small enough that in-memory counting adds negligible
 *     overhead.
 *   - On any DB error or an unexpected (non-array) response the function
 *     returns [] so callers can treat it as a no-op fallback rather than
 *     crashing the render.
 *   - `is_approved` (NOT `approved`) is the correct column name on
 *     public.tags (see 0002_content.sql); soft-deleted posts are excluded
 *     via `posts.deleted_at IS NULL`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface TrendingTag {
  slug: string
  name: string
  count: number
}

interface PostTagJoinRow {
  tag_slug: string
  tags: { slug: string; name: string; is_approved: boolean } | null
  posts: { published_at: string; deleted_at: string | null } | null
}

/**
 * Returns the top `limit` approved tags by post-count within the last
 * `windowDays` days.
 *
 * @param db         - Supabase client (service-role recommended so the
 *                     query bypasses RLS; all columns read are public).
 * @param windowDays - Rolling window in days (default 7).
 * @param limit      - Max tags to return (default 5).
 */
export async function getTrendingTags(
  db: Pick<SupabaseClient, 'from'>,
  windowDays = 7,
  limit = 5,
): Promise<TrendingTag[]> {
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  const { data, error } = await db
    .from('post_tags')
    .select(
      'tag_slug, tags!inner(slug, name, is_approved), posts!inner(published_at, deleted_at)',
    )
    .gte('posts.published_at', sinceIso)
    .is('posts.deleted_at', null)
    .eq('tags.is_approved', true)

  if (error || !Array.isArray(data)) return []

  const rows = data as unknown as PostTagJoinRow[]

  // Count occurrences per tag_slug in-memory and capture the display name.
  const counts = new Map<string, { name: string; count: number }>()
  for (const row of rows) {
    if (!row.tags) continue
    const slug = row.tags.slug ?? row.tag_slug
    if (!slug) continue
    const name = row.tags.name ?? slug
    const entry = counts.get(slug)
    if (entry) {
      entry.count += 1
    } else {
      counts.set(slug, { name, count: 1 })
    }
  }

  return Array.from(counts.entries())
    .map(([slug, { name, count }]) => ({ slug, name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
