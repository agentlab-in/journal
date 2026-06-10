/**
 * TrendingFeed — global heat-ranked feed for the /trending route.
 *
 * Async server component. Renders the top 30 posts published within the
 * last 7 days, ranked by heat-score (engagement over time-decay).
 *
 * ### Data flow
 *
 * 1. Fetch a raw shortlist from `shortlistByHeat` (RPC `feed_shortlist_by_heat`,
 *    migration 0009). The anon role has EXECUTE on that function (see the
 *    `GRANT EXECUTE … TO anon` at the bottom of 0009_feed_shortlist_rpc.sql),
 *    but `feed_shortlist_by_heat` is SECURITY DEFINER — so even though anon
 *    cannot read `public.posts` directly (post-0014 RLS hardening), the RPC
 *    bypasses that restriction inside the function body.
 *
 *    We use `createAdminSupabaseClient()` here anyway for the same reason
 *    `lib/feed/discovery-cache.ts` does: the query is viewer-agnostic over
 *    public columns, and the service-role client keeps the call consistent
 *    with the rest of the discovery layer rather than relying on an anon
 *    grant that a future migration might narrow.  Privileged access is NOT
 *    the reason; query capability parity with the rest of the discovery layer is.
 *
 * 2. Filter rows published within the last 7 days IN MEMORY.  The RPC has no
 *    window parameter — it returns all non-deleted posts ordered by raw heat,
 *    so we apply the window client-side before re-scoring.
 *
 * 3. Re-score with `computeHeatScore` (`tag_affinity: 0` — this feed is
 *    viewer-independent), sort descending, take 30.
 *
 * 4. Hydrate + render exactly like the home FeedList and /latest LatestList:
 *    `fetchAuthors`, `fetchTagsByPost`, `fetchOrgsByPost` from
 *    `@/lib/feed/hydrate`, then `PostCard` inside `KeyboardFeedNav`.
 *
 * ### Intentional duplication
 *
 * The hydration block below duplicates the shape of `app/page.tsx`'s
 * `FeedList` function rather than extracting a shared helper. This is the
 * plan's explicit choice (Phase C brief: "DUPLICATE the hydration block …
 * to keep the diff small") because abstracting the three feed surfaces
 * (home / latest / trending) is a follow-up refactor that needs its own
 * review. TODO(follow-up): extract a `FeedHydrator` utility so the three
 * surfaces share the author+tag+org hydration loop.
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { shortlistByHeat } from '@/lib/feed/shortlist'
import { computeHeatScore } from '@/lib/heat'
import {
  fetchAuthors,
  fetchTagsByPost,
  fetchOrgsByPost,
  type TagInfo,
} from '@/lib/feed/hydrate'
import { PostCard, type PostCardData } from '@/components/post/PostCard'
import { KeyboardFeedNav } from '@/components/keyboard/KeyboardFeedNav'

/** Seven days expressed in milliseconds — the trending window. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/** Maximum cards to render. */
const PAGE_SIZE = 30

export async function TrendingFeed() {
  const db = createAdminSupabaseClient()

  // --- Step 1: shortlist from DB (heat-ordered, no time-window in RPC) ---
  const shortlist = await shortlistByHeat(db)

  // --- Step 2: filter to last-7-day window IN MEMORY ---
  const now = new Date()
  const cutoff = now.getTime() - SEVEN_DAYS_MS
  const inWindow = shortlist.filter((r) => {
    const ts = Date.parse(r.published_at)
    return Number.isFinite(ts) && ts >= cutoff
  })

  // --- Step 3: re-score with computeHeatScore (tag_affinity: 0 = viewer-independent) ---
  const scored = inWindow
    .map((r) => ({
      ...r,
      _heat: computeHeatScore(
        {
          published_at: r.published_at,
          like_count: r.like_count,
          bookmark_count: r.bookmark_count,
          tag_affinity: 0,
        },
        now,
      ),
    }))
    .sort((a, b) => b._heat - a._heat)
    .slice(0, PAGE_SIZE)

  if (scored.length === 0) {
    return (
      <p className="home-feed__empty">
        Nothing trending yet. Check back soon.
      </p>
    )
  }

  // --- Step 4: hydrate authors, tags, orgs ---
  const postIds = scored.map((r) => r.id)
  const uniqueAuthorIds = Array.from(new Set(scored.map((r) => r.author_id)))

  const [authorMap, tagMap, orgMap] = await Promise.all([
    fetchAuthors(db, uniqueAuthorIds),
    fetchTagsByPost(db, postIds),
    fetchOrgsByPost(db, postIds),
  ])

  // --- Step 5: build PostCardData[] ---
  const cards: PostCardData[] = []
  for (const r of scored) {
    const author = authorMap.get(r.author_id)
    if (!author) continue
    const tags: TagInfo[] = tagMap.get(r.id) ?? []
    cards.push({
      id: r.id,
      type: r.type as PostCardData['type'],
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      published_at: r.published_at,
      like_count: r.like_count,
      bookmark_count: r.bookmark_count,
      comment_count: r.comment_count,
      author: {
        username: author.username,
        display_name: author.display_name ?? author.username,
        avatar_url: author.avatar_url,
      },
      org: orgMap.get(r.id) ?? null,
      tags,
    })
  }

  if (cards.length === 0) {
    return (
      <p className="home-feed__empty">
        Nothing trending yet. Check back soon.
      </p>
    )
  }

  return (
    <KeyboardFeedNav>
      <ul className="home-feed__list">
        {cards.map((c) => (
          <li key={c.id} className="home-feed__item">
            <PostCard post={c} />
          </li>
        ))}
      </ul>
    </KeyboardFeedNav>
  )
}
