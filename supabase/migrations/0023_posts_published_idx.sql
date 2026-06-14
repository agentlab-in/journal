-- =============================================================================
-- 0023_posts_published_idx.sql
-- perf/page-load — recency-feed supporting index.
--
-- `getLatestFeed` (lib/feed/index.ts) and `feed_shortlist_by_heat`'s window
-- predicate run a global recency scan:
--
--     SELECT ... FROM public.posts
--     WHERE deleted_at IS NULL AND published_at <= now()
--     ORDER BY published_at DESC
--     LIMIT 30;
--
-- No existing index serves this. Every posts_*_published_idx leads with a
-- different column (author_id / type / org_id), so none can satisfy a
-- *global* ORDER BY published_at — the planner falls back to a seq scan +
-- sort on public.posts.
--
-- This partial index mirrors the leading-column pattern of the existing
-- partial indexes (WHERE deleted_at IS NULL) so the planner can serve the
-- ordering and the published_at upper-bound from the index directly.
--
-- Plain CREATE INDEX (not CONCURRENTLY) to match the existing migration
-- convention and stay transaction-safe; the posts table is small at this
-- stage so the brief lock is a non-issue.
-- =============================================================================

CREATE INDEX IF NOT EXISTS posts_published_idx
    ON public.posts (published_at DESC)
    WHERE deleted_at IS NULL;
