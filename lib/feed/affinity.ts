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
 *
 * --- Performance (post-review-feedback #3) ---
 *
 * The three engagement-source reads (likes, bookmarks, follows-step-1) are
 * independent and run in parallel via `Promise.all`. Step-4 (posts authored
 * by followed users) still has to wait on step-3's results because it needs
 * the followed-user IDs. Worst case round-trip count drops from 4→2.
 *
 * The computed tag-weight map is cached in-process per viewer for 5 minutes
 * (see `AFFINITY_TTL_MS`). The cache lives in module-level state so it
 * survives within a single warm Lambda container; cold starts begin empty.
 * The cache stores the raw `weights` map (pre-slice / pre-Set conversion)
 * so callers with different `limit` options share the same cache entry.
 * Cap is `AFFINITY_CACHE_MAX_ENTRIES`; on overflow we evict the
 * oldest-inserted entry (Map insertion-order ⇒ trivial LRU-by-insert).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Default cap on the size of the returned slug set. */
const DEFAULT_LIMIT = 8

/** Per-source raw-row cap to keep memory bounded. */
const SOURCE_ROW_CAP = 500

/** Half-life-ish recency window in days. */
const RECENCY_HALF_LIFE_DAYS = 30

/** Per-viewer affinity cache TTL: 5 minutes. */
const AFFINITY_TTL_MS = 5 * 60 * 1000

/** Hard cap on number of cached viewer entries (per warm container). Worst case ~12MB per warm container (1000 viewers × 500 tags). */
const AFFINITY_CACHE_MAX_ENTRIES = 1000

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

interface CacheEntry {
  /** Pre-slice tag→weight map, so different `limit` values share a hit. */
  weights: Map<string, number>
  expiresAt: number
}

/**
 * Module-level affinity cache. Survives across requests within a warm
 * Lambda container; cold starts get a fresh empty map. Key = viewerId.
 */
const affinityCache = new Map<string, CacheEntry>()

/**
 * Test-only escape hatch to reset module state between unit-test cases.
 * Production code MUST NOT call this — production cache invalidation is
 * via natural TTL expiry.
 */
export function _clearAffinityCacheForTests(): void {
  affinityCache.clear()
}

function timingEnabled(): boolean {
  return process.env.FEED_TIMING_LOGS === '1'
}

function timeLog(label: string, ms: number, extra?: Record<string, unknown>): void {
  if (!timingEnabled()) return
  // Single-line JSON so Vercel's log ingester parses it as structured.
  console.log(
    JSON.stringify({ event: 'feed_timing', label, ms: Math.round(ms), ...extra }),
  )
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

/**
 * Compute the raw viewer→tag-weight map by hitting Supabase. No caching,
 * no slicing — the public `getViewerTagAffinity` layers those on top.
 */
async function computeWeights(
  db: Pick<SupabaseClient, 'from'>,
  viewerId: string,
  now: Date,
): Promise<Map<string, number>> {
  const weights = new Map<string, number>()

  // Steps 1, 2, 3 are independent — fire them in parallel. Step 4 (posts
  // authored by followed users) needs the followed_id list from step 3,
  // so it still has to wait.
  const t0 = performance.now()
  const [likesQuery, bookmarksQuery, followsQuery] = await Promise.all([
    db
      .from('likes')
      .select(
        'created_at, posts(post_tags(tag_slug, tags(slug, is_approved)))',
      )
      .eq('user_id', viewerId)
      .order('created_at', { ascending: false })
      .limit(SOURCE_ROW_CAP),
    db
      .from('bookmarks')
      .select(
        'created_at, posts(post_tags(tag_slug, tags(slug, is_approved)))',
      )
      .eq('user_id', viewerId)
      .order('created_at', { ascending: false })
      .limit(SOURCE_ROW_CAP),
    db
      .from('follows')
      .select('followed_id')
      .eq('follower_id', viewerId)
      .limit(SOURCE_ROW_CAP),
  ])
  timeLog('affinity.parallel_engagement', performance.now() - t0, {
    likes_ok: !likesQuery.error,
    bookmarks_ok: !bookmarksQuery.error,
    follows_ok: !followsQuery.error,
  })

  // 1. Likes
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

  // 2. Bookmarks
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

  // 3. Follows → 4. Posts authored by followed users.
  // Two-step: the PostgREST JSON-syntax for joining follows → users → posts
  // → post_tags is awkward (the FK between users and posts is on
  // author_id, not the followed_id we want), so we go in two simple
  // queries. Step 4 has to wait for step 3 to know the IDs.
  if (!followsQuery.error && Array.isArray(followsQuery.data)) {
    const followedIds = (followsQuery.data as unknown as FollowsRow[])
      .map((f) => f.followed_id)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)

    if (followedIds.length > 0) {
      const t1 = performance.now()
      const authorPostsQuery = await db
        .from('posts')
        .select('published_at, post_tags(tag_slug, tags(slug, is_approved))')
        .in('author_id', followedIds)
        .is('deleted_at', null)
        .order('published_at', { ascending: false })
        .limit(SOURCE_ROW_CAP)
      timeLog('affinity.author_posts', performance.now() - t1, {
        followed_count: followedIds.length,
        ok: !authorPostsQuery.error,
      })

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

  return weights
}

export async function getViewerTagAffinity(
  db: Pick<SupabaseClient, 'from'>,
  viewerId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<Set<string>> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const now = options.now ?? new Date()

  const overallStart = performance.now()
  let weights: Map<string, number>

  // Cache lookup first — module-level state survives within a warm
  // container, gets cleared on cold start. 5-min TTL.
  const cached = affinityCache.get(viewerId)
  if (cached && cached.expiresAt > now.getTime()) {
    weights = cached.weights
    timeLog('affinity.cache_hit', 0, { viewer_id: viewerId })
  } else {
    if (cached) {
      // Expired entry — drop it so the eviction-cap check below operates
      // on a clean count.
      affinityCache.delete(viewerId)
    }

    weights = await computeWeights(db, viewerId, now)

    // Cap-evict before insert: drop the oldest-inserted entry if we'd
    // exceed the bound. Map iteration is insertion-order, so the first
    // key is the oldest.
    if (affinityCache.size >= AFFINITY_CACHE_MAX_ENTRIES) {
      const oldest = affinityCache.keys().next().value
      if (oldest !== undefined) affinityCache.delete(oldest)
    }

    affinityCache.set(viewerId, {
      weights: new Map(weights), // defensive snapshot, not a live reference
      expiresAt: now.getTime() + AFFINITY_TTL_MS,
    })
    timeLog('affinity.cache_miss', performance.now() - overallStart, {
      viewer_id: viewerId,
      distinct_tags: weights.size,
    })
  }

  // Sort by weight desc, slice to `limit`, return as a Set.
  const sorted = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([slug]) => slug)

  timeLog('affinity.total', performance.now() - overallStart, {
    viewer_id: viewerId,
    returned: sorted.length,
  })

  return new Set(sorted)
}
