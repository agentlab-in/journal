/**
 * DB-side shortlist by raw heat — viewer-independent first pass for the
 * "For You" feed.
 *
 * Delegates to the `feed_shortlist_by_heat` SQL function (migration 0009)
 * because PostgREST's `.order()` only accepts column names, not arbitrary
 * expressions. The RPC orders posts by
 *
 *     (like_count + 2 * bookmark_count)
 *   / pow(extract(epoch from (now() - published_at)) / 3600 + 2, 1.5)
 *
 * and returns the top `limit` non-deleted rows. The caller (`lib/feed/index`)
 * then layers viewer-specific tag affinity on top via `rerankWithAffinity`.
 *
 * Default limit (200) is intentionally larger than the user-visible page size
 * (~30) so the rerank step has enough breadth to surface posts the viewer
 * actually cares about — not just the global top-30.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_LIMIT = 200

export interface ShortlistRow {
  id: string
  author_id: string
  type: 'post' | 'playbook' | 'dive'
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
  like_count: number
  bookmark_count: number
  comment_count: number
}

interface RpcRow {
  id: string
  author_id: string
  type: string
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
  like_count: number | null
  bookmark_count: number | null
  comment_count: number | null
}

export async function shortlistByHeat(
  db: Pick<SupabaseClient, 'rpc'>,
  options: { limit?: number } = {},
): Promise<ShortlistRow[]> {
  const limit = options.limit ?? DEFAULT_LIMIT

  const { data, error } = await db.rpc('feed_shortlist_by_heat', {
    p_limit: limit,
  })

  if (error || !Array.isArray(data)) return []

  return (data as RpcRow[]).map((r) => ({
    id: r.id,
    author_id: r.author_id,
    // Narrow the open `text` column to the union the rest of the codebase
    // uses. The DB CHECK constraint on posts.type already guarantees this.
    type: r.type as ShortlistRow['type'],
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    cover_image_url: r.cover_image_url,
    published_at: r.published_at,
    like_count: r.like_count ?? 0,
    bookmark_count: r.bookmark_count ?? 0,
    comment_count: r.comment_count ?? 0,
  }))
}
