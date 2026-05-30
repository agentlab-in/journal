/**
 * Viewer tag-affinity computation for the "For You" feed.
 *
 * Returns the set of tag slugs the viewer has implicitly endorsed via
 * recent engagement — likes, bookmarks, and follows. The set is small (top
 * `limit` slugs by recency-weighted occurrence count) and is fed into
 * `rerankWithAffinity`, which treats any overlap with a post's tags as the
 * +5 heat-score boost defined in `lib/heat.ts`.
 *
 * Signal sources (all weighted by exp(-daysSince / 30)):
 *
 *   1. `likes` — tags of posts the viewer liked.
 *   2. `bookmarks` — tags of posts the viewer bookmarked.
 *   3. `follows` — tags of posts authored by users the viewer follows
 *      (weighted by the post's `published_at`, not the follow's
 *      `created_at` — the engagement signal is "I asked to see this person's
 *      writing", and freshness of their writing is the proxy for how
 *      relevant their topic mix is right now).
 *
 * Each source is capped at the 500 most-recent rows so a hyperactive viewer
 * doesn't drag in megabytes of joined post_tags rows. This is a soft
 * personalization signal — we trade exhaustiveness for bounded memory.
 *
 * Tags whose `tags.is_approved = false` are filtered out (unapproved tags
 * exist as user-suggested-but-unreviewed and are not visible to anyone but
 * service-role; ranking on them would surface posts via an invisible
 * signal).
 *
 * The caller must pass a service-role client. `likes`, `bookmarks`, and
 * `follows` are owner-only-read under RLS (migration 0002) — the SSR anon
 * client would return zero rows for any third-party viewer.
 *
 * `now` is injectable so unit tests are deterministic.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Default cap on the size of the returned slug set. */
const DEFAULT_LIMIT = 8

/** Per-source raw-row cap to keep memory bounded. */
const SOURCE_ROW_CAP = 500

/** Half-life-ish recency window in days. */
const RECENCY_HALF_LIFE_DAYS = 30

interface TagRow {
  slug: string
  is_approved: boolean
}

interface PostTagRow {
  tag_slug: string
  tags: TagRow | null
}

interface PostWithTagsRow {
  post_tags: PostTagRow[] | null
}

interface EngagementRow {
  created_at: string
  posts: PostWithTagsRow | null
}

interface AuthorPostRow {
  published_at: string
  post_tags: PostTagRow[] | null
}

interface FollowsRow {
  followed_id: string
}

function recencyWeight(eventTimestamp: string, now: Date): number {
  const ms = now.getTime() - Date.parse(eventTimestamp)
  if (!Number.isFinite(ms)) return 0
  const days = Math.max(ms / 86_400_000, 0)
  return Math.exp(-days / RECENCY_HALF_LIFE_DAYS)
}

/**
 * Accumulate weighted occurrences of approved tag_slugs into `weights`.
 * Each row contributes its `weight` to every distinct approved tag_slug
 * attached to the underlying post.
 */
function accumulate(
  weights: Map<string, number>,
  rows: Array<{ weight: number; post_tags: PostTagRow[] | null }>,
): void {
  for (const row of rows) {
    if (row.weight <= 0) continue
    const tags = row.post_tags
    if (!tags || tags.length === 0) continue
    for (const pt of tags) {
      const tag = pt.tags
      if (!tag) continue
      if (tag.is_approved !== true) continue
      const slug = tag.slug ?? pt.tag_slug
      if (!slug) continue
      weights.set(slug, (weights.get(slug) ?? 0) + row.weight)
    }
  }
}

export async function getViewerTagAffinity(
  db: Pick<SupabaseClient, 'from'>,
  viewerId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<Set<string>> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const now = options.now ?? new Date()

  const weights = new Map<string, number>()

  // 1. Likes ---------------------------------------------------------------
  const likesQuery = await db
    .from('likes')
    .select(
      'created_at, posts(post_tags(tag_slug, tags(slug, is_approved)))',
    )
    .eq('user_id', viewerId)
    .order('created_at', { ascending: false })
    .limit(SOURCE_ROW_CAP)

  if (!likesQuery.error && Array.isArray(likesQuery.data)) {
    const rows = likesQuery.data as unknown as EngagementRow[]
    accumulate(
      weights,
      rows.map((r) => ({
        weight: recencyWeight(r.created_at, now),
        post_tags: r.posts?.post_tags ?? null,
      })),
    )
  }

  // 2. Bookmarks -----------------------------------------------------------
  const bookmarksQuery = await db
    .from('bookmarks')
    .select(
      'created_at, posts(post_tags(tag_slug, tags(slug, is_approved)))',
    )
    .eq('user_id', viewerId)
    .order('created_at', { ascending: false })
    .limit(SOURCE_ROW_CAP)

  if (!bookmarksQuery.error && Array.isArray(bookmarksQuery.data)) {
    const rows = bookmarksQuery.data as unknown as EngagementRow[]
    accumulate(
      weights,
      rows.map((r) => ({
        weight: recencyWeight(r.created_at, now),
        post_tags: r.posts?.post_tags ?? null,
      })),
    )
  }

  // 3. Follows -------------------------------------------------------------
  // Two-step: first the followed user ids, then their recent posts. The
  // PostgREST JSON-syntax for joining follows → users → posts → post_tags
  // is awkward (the FK between users and posts is on author_id, not the
  // followed_id we want), so we go in two simple queries.
  const followsQuery = await db
    .from('follows')
    .select('followed_id')
    .eq('follower_id', viewerId)
    .limit(SOURCE_ROW_CAP)

  if (!followsQuery.error && Array.isArray(followsQuery.data)) {
    const followedIds = (followsQuery.data as unknown as FollowsRow[])
      .map((f) => f.followed_id)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)

    if (followedIds.length > 0) {
      const authorPostsQuery = await db
        .from('posts')
        .select('published_at, post_tags(tag_slug, tags(slug, is_approved))')
        .in('author_id', followedIds)
        .is('deleted_at', null)
        .order('published_at', { ascending: false })
        .limit(SOURCE_ROW_CAP)

      if (!authorPostsQuery.error && Array.isArray(authorPostsQuery.data)) {
        const rows = authorPostsQuery.data as unknown as AuthorPostRow[]
        accumulate(
          weights,
          rows.map((r) => ({
            weight: recencyWeight(r.published_at, now),
            post_tags: r.post_tags ?? null,
          })),
        )
      }
    }
  }

  // Sort by weight desc, slice to `limit`, return as a Set.
  const sorted = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([slug]) => slug)

  return new Set(sorted)
}
