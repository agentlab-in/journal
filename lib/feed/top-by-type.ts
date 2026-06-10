/**
 * getTopByType — returns the top `limit` posts of a given type within
 * the last `windowDays` days, ranked by the canonical heat-score formula.
 *
 * Why rerank in memory:
 *   `computeHeatScore` is the canonical, unit-tested heat formulation that
 *   drives the main For-You feed. Duplicating the formula in SQL (ORDER BY
 *   a computed expression) would create two independent definitions that
 *   must be kept in sync whenever the scoring weights change. In-memory
 *   reranking on a small candidate pool (≤50 rows) is negligible overhead
 *   and guarantees the trending rails and the main feed agree on what
 *   "hot" means.
 *
 * URL correctness for org posts:
 *   The canonical post URL is `/{leadingSegment}/{type}/{slug}` where
 *   `leadingSegment` is the org slug when the post was published under an
 *   org, else the author username (see `app/api/posts/route.ts` step 17
 *   and `postUrl` in `lib/posts/url.ts`). Rows returned here carry a
 *   `leading_segment` field — org slug when present, author username
 *   otherwise — so callers can build the correct URL without additional
 *   round-trips.
 *
 * On any DB error or unexpected response the function returns [] so callers
 * can treat it as a no-op fallback rather than crashing the render.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeHeatScore } from '@/lib/heat'

export interface TopPostRow {
  id: string
  slug: string
  title: string
  type: 'playbook' | 'dive'
  /** Org slug when posted under an org, else the author's username. */
  leading_segment: string
  author_username: string
  author_display_name: string
  like_count: number
}

interface RawPostRow {
  id: string
  slug: string
  title: string
  type: string
  org_id: string | null
  published_at: string
  like_count: number | null
  bookmark_count: number | null
  /** Aliased join via posts.author_id FK */
  author: { username: string; display_name: string | null } | null
  /** Aliased join via posts.org_id FK */
  orgs: { slug: string } | null
}

/**
 * Returns the top `limit` posts of `type` (playbook | dive) within the
 * last `windowDays` days, ranked by heat-score descending.
 *
 * @param db         - Supabase client.
 * @param type       - Post type to filter on ('playbook' | 'dive').
 * @param windowDays - Rolling window in days (default 7).
 * @param limit      - Max posts to return after reranking (default 3).
 */
export async function getTopByType(
  db: Pick<SupabaseClient, 'from'>,
  type: 'playbook' | 'dive',
  windowDays = 7,
  limit = 3,
): Promise<TopPostRow[]> {
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  const { data, error } = await db
    .from('posts')
    .select(
      'id, slug, title, type, org_id, published_at, like_count, bookmark_count, author:users!posts_author_id_fkey(username, display_name), orgs(slug)',
    )
    .eq('type', type)
    .gte('published_at', sinceIso)
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .limit(50)

  if (error || !Array.isArray(data)) return []

  const rows = data as unknown as RawPostRow[]

  // Why rerank in memory: computeHeatScore is the canonical, unit-tested
  // heat formulation; duplicating it in SQL would create two definitions
  // to keep in sync.
  const scored = rows
    .filter((r) => r.author !== null)
    .map((r) => ({
      row: r,
      score: computeHeatScore({
        published_at: r.published_at,
        like_count: r.like_count ?? 0,
        bookmark_count: r.bookmark_count ?? 0,
        tag_affinity: 0,
      }),
    }))

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map(({ row: r }) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    type: r.type as 'playbook' | 'dive',
    // Org slug when published under an org, else the author's username.
    leading_segment: r.orgs?.slug ?? r.author!.username,
    author_username: r.author!.username,
    author_display_name: r.author!.display_name ?? r.author!.username,
    like_count: r.like_count ?? 0,
  }))
}
