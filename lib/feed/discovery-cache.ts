/**
 * Discovery-cache module — the ONLY place in this codebase that calls
 * `unstable_cache` for the home-discovery rails.
 *
 * Design decisions:
 *
 * 1. Centralised: keeping all three cached wrappers in one file (the
 *    "closure-over-config" pattern) makes it easy to reason about key
 *    collisions and TTL policy at a glance.  Zero runtime args means
 *    the cache keys are fully deterministic — no user-supplied strings
 *    can collide.
 *
 * 2. Service-role client: the cached result is shared across ALL viewers
 *    (the query is viewer-agnostic — it returns the same popular tags
 *    and top posts regardless of who is asking). A service-role client
 *    is used for query simplicity, not privileged access — every column
 *    read here is already covered by the public-read RLS policies on
 *    `posts`, `tags`, `post_tags`, and `users_public`.
 *
 * 3. TTL + tag invalidation: `revalidate: 600` (10 min) is the safety net
 *    that caps the maximum staleness even if a cache invalidation event is
 *    missed.  The `tags: ['posts', 'tags']` annotation means any Route
 *    Handler that calls `revalidateTag('posts', { expire: 0 })` immediately
 *    expires these entries — this is the fast path (publish / edit / delete
 *    invalidates the cache inline, so the very next request re-queries).
 *
 * 4. Risk 6 mitigation: first `unstable_cache` usage in this repo. By
 *    isolating it here callers never import `unstable_cache` directly and
 *    tests can mock `@/lib/feed/discovery-cache` at the module level without
 *    touching the runtime code.
 *
 * 5. Cold-cache fan-out: `unstable_cache` does NOT deduplicate concurrent
 *    cold-cache invocations within a single render pass — the same rail is
 *    awaited from multiple Suspense islands, so a cold cache can fan out a
 *    few parallel identical queries.  This is acceptable: results are
 *    consistent and the 600 s TTL means fan-out is bounded to the first
 *    requests immediately after invalidation.
 */

import { unstable_cache } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getTrendingTags } from './trending-tags'
import { getTopByType } from './top-by-type'

/**
 * Cached trending-tag query — top 5 approved tags by post-count in the
 * last 7 days. Revalidates every 600 s or on `revalidateTag('tags', ...)`.
 */
export const cachedTrendingTags = unstable_cache(
  () => getTrendingTags(createAdminSupabaseClient(), 7, 5),
  ['trending-tags-v1'],
  { revalidate: 600, tags: ['posts', 'tags'] },
)

/**
 * Cached top-playbooks query — top 3 playbooks by heat-score in the last
 * 7 days. Revalidates every 600 s or on `revalidateTag('posts', ...)`.
 */
export const cachedTopPlaybooks = unstable_cache(
  () => getTopByType(createAdminSupabaseClient(), 'playbook', 7, 3),
  ['top-playbooks-7d-v1'],
  { revalidate: 600, tags: ['posts'] },
)

/**
 * Cached top-dives query — top 3 deep dives by heat-score in the last
 * 7 days. Revalidates every 600 s or on `revalidateTag('posts', ...)`.
 */
export const cachedTopDives = unstable_cache(
  () => getTopByType(createAdminSupabaseClient(), 'dive', 7, 3),
  ['top-dives-7d-v1'],
  { revalidate: 600, tags: ['posts'] },
)
