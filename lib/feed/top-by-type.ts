/**
 * getTopByType: returns the most recent `limit` posts of a given type
 * published within the last `windowDays` days, ranked by `published_at`
 * descending.
 *
 * URL correctness for org posts:
 *   The canonical post URL is `/{leadingSegment}/{type}/{slug}` where
 *   `leadingSegment` is the org slug when the post was published under an
 *   org, else the author username (see `app/api/posts/route.ts` step 17
 *   and `postUrl` in `lib/posts/url.ts`). Rows returned here carry a
 *   `leading_segment` field (org slug when present, author username
 *   otherwise) so callers can build the correct URL without additional
 *   round-trips.
 *
 * On any DB error or unexpected response the function returns [] so callers
 * can treat it as a no-op fallback rather than crashing the render.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface TopPostRow {
  id: string
  slug: string
  title: string
  type: 'playbook' | 'dive'
  /** Org slug when posted under an org, else the author's username. */
  leading_segment: string
  author_username: string
  author_display_name: string
}

interface RawPostRow {
  id: string
  slug: string
  title: string
  type: string
  org_id: string | null
  published_at: string
  /** Aliased join via posts.author_id FK */
  author: { username: string; display_name: string | null } | null
  /** Aliased join via posts.org_id FK */
  orgs: { slug: string } | null
}

/**
 * Returns the most recent `limit` posts of `type` (playbook | dive) within
 * the last `windowDays` days, newest first.
 *
 * @param db         - Supabase client.
 * @param type       - Post type to filter on ('playbook' | 'dive').
 * @param windowDays - Rolling window in days (default 7).
 * @param limit      - Max posts to return (default 3).
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
      'id, slug, title, type, org_id, published_at, author:users!posts_author_id_fkey(username, display_name), orgs(slug)',
    )
    .eq('type', type)
    .gte('published_at', sinceIso)
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .limit(50)

  if (error || !Array.isArray(data)) return []

  const rows = data as unknown as RawPostRow[]

  // Over-fetch (50) and filter nulls before slicing to `limit` so a run of
  // posts with a vanished author (FK is RESTRICT, so effectively
  // unreachable in production) doesn't shrink the visible rail below
  // `limit` when more eligible rows exist further down the query.
  return rows
    .filter((r) => r.author !== null)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      type: r.type as 'playbook' | 'dive',
      // Org slug when published under an org, else the author's username.
      leading_segment: r.orgs?.slug ?? r.author!.username,
      author_username: r.author!.username,
      author_display_name: r.author!.display_name ?? r.author!.username,
    }))
}
