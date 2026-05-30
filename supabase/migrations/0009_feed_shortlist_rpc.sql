-- =============================================================================
-- Migration 0009 — Feed shortlist RPC
--
-- The "For You" home feed (Phase 9) ranks posts in two stages:
--
--   1. shortlist (DB-side): top-N posts by a raw-heat expression. The
--      expression mirrors `lib/heat.ts`'s formula but omits the tag-affinity
--      boost, since affinity is viewer-specific and the shortlist is
--      viewer-independent.
--
--   2. rerank (app-side): the viewer's tag affinity is layered on top of
--      the shortlist with the +5 boost from `lib/heat.ts` and the final
--      page is sliced down to ~30 rows.
--
-- The raw-heat formula:
--
--     (like_count + 2 * bookmark_count)
--   / pow(extract(epoch from (now() - published_at)) / 3600 + 2, 1.5)
--
-- PostgREST's `.order()` only accepts column names, not arbitrary
-- expressions, so we expose the shortlist as a SECURITY DEFINER function
-- and call it via `db.rpc('feed_shortlist_by_heat', { p_limit })`.
-- SECURITY DEFINER + locked search_path matches the pattern from 0004 and
-- 0007/0008. The function only reads `public.posts`, so the elevated grant
-- doesn't widen any attack surface.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.feed_shortlist_by_heat(p_limit integer DEFAULT 200)
RETURNS TABLE (
    id              uuid,
    author_id       uuid,
    type            text,
    slug            text,
    title           text,
    summary         text,
    cover_image_url text,
    published_at    timestamptz,
    like_count      integer,
    bookmark_count  integer,
    comment_count   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        p.id,
        p.author_id,
        p.type,
        p.slug,
        p.title,
        p.summary,
        p.cover_image_url,
        p.published_at,
        p.like_count,
        p.bookmark_count,
        p.comment_count
    FROM public.posts p
    WHERE p.deleted_at IS NULL
    ORDER BY
        (p.like_count + 2 * p.bookmark_count)::float8
        / pow(extract(epoch FROM (now() - p.published_at)) / 3600 + 2, 1.5)
        DESC,
        p.published_at DESC
    LIMIT GREATEST(p_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION public.feed_shortlist_by_heat(integer)
    TO anon, authenticated, service_role;
