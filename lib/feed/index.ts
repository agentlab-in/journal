/**
 * Public entry points for the home-feed module.
 *
 *   getForYouFeed(db, viewerId)   — personalized ranked feed for an
 *                                   authenticated viewer.
 *   getLatestFeed(db)             — anon-friendly fallback: most recent
 *                                   non-deleted posts, no ranking.
 *
 * `getForYouFeed` runs three queries in sequence (the rerank needs the
 * shortlist's ids before it can fetch per-post tags) and then a pure
 * rerank pass. The shortlist is intentionally wider than the user-visible
 * page so the rerank has breadth — global top-30 alone would surface the
 * same handful of posts to every viewer.
 *
 * Both functions take a Supabase client (typically the service-role one
 * from `lib/supabase/server.ts` for `getForYouFeed`; either works for
 * `getLatestFeed` — anon RLS already exposes non-deleted posts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getViewerTagAffinity } from './affinity'
import { shortlistByHeat, type ShortlistRow } from './shortlist'
import { rerankWithAffinity, type RerankRow } from './rerank'

export type { ShortlistRow } from './shortlist'
export type { RerankRow } from './rerank'
export { getViewerTagAffinity } from './affinity'
export { shortlistByHeat } from './shortlist'
export { rerankWithAffinity } from './rerank'

const FOR_YOU_DEFAULT_LIMIT = 30
const FOR_YOU_DEFAULT_SHORTLIST_SIZE = 200
const LATEST_DEFAULT_LIMIT = 30

interface TagJoinRow {
  post_id: string
  tag_slug: string
  tags: { slug: string; is_approved: boolean } | null
}

/**
 * Personalized home feed. Affinity → shortlist → tag-attach → rerank.
 */
export async function getForYouFeed(
  db: SupabaseClient,
  viewerId: string,
  options: { limit?: number; shortlistSize?: number; now?: Date } = {},
): Promise<RerankRow[]> {
  const limit = options.limit ?? FOR_YOU_DEFAULT_LIMIT
  const shortlistSize = options.shortlistSize ?? FOR_YOU_DEFAULT_SHORTLIST_SIZE
  const now = options.now ?? new Date()

  const [affinity, shortlist] = await Promise.all([
    getViewerTagAffinity(db, viewerId, { now }),
    shortlistByHeat(db, { limit: shortlistSize }),
  ])

  if (shortlist.length === 0) return []

  // Fetch approved tag slugs for every shortlisted post in a single round-trip.
  const ids = shortlist.map((p) => p.id)
  const { data: tagData, error: tagError } = await db
    .from('post_tags')
    .select('post_id, tag_slug, tags(slug, is_approved)')
    .in('post_id', ids)

  const tagsByPost = new Map<string, string[]>()
  if (!tagError && Array.isArray(tagData)) {
    const rows = tagData as unknown as TagJoinRow[]
    for (const r of rows) {
      if (!r.tags || r.tags.is_approved !== true) continue
      const slug = r.tags.slug ?? r.tag_slug
      if (!slug) continue
      const list = tagsByPost.get(r.post_id)
      if (list) list.push(slug)
      else tagsByPost.set(r.post_id, [slug])
    }
  }

  const enriched: RerankRow[] = shortlist.map((p) => ({
    ...p,
    tag_slugs: tagsByPost.get(p.id) ?? [],
  }))

  return rerankWithAffinity(enriched, affinity, { limit, now })
}

interface PostsLatestRow {
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

/**
 * Anon-friendly fallback: most recent non-deleted posts, no ranking.
 *
 * Used for the logged-out homepage and as a safety net when the
 * personalized feed has nothing to show.
 */
export async function getLatestFeed(
  db: Pick<SupabaseClient, 'from'>,
  options: { limit?: number } = {},
): Promise<ShortlistRow[]> {
  const limit = options.limit ?? LATEST_DEFAULT_LIMIT

  const { data, error } = await db
    .from('posts')
    .select(
      'id, author_id, type, slug, title, summary, cover_image_url, published_at, like_count, bookmark_count, comment_count',
    )
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error || !Array.isArray(data)) return []

  return (data as PostsLatestRow[]).map((r) => ({
    id: r.id,
    author_id: r.author_id,
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
