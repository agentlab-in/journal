-- =============================================================================
-- Migration 0010 — search_posts RPC
--
-- The /search page (Phase 9, Task 7) ranks posts by full-text relevance over
-- the existing `posts.search_tsv` GIN-indexed tsvector (defined in 0002).
--
-- PostgREST's chainable query builder can call `websearch_to_tsquery` via
-- `.textSearch('search_tsv', q, { type: 'websearch' })`, but it can NOT
-- ORDER BY `ts_rank_cd(...)` because order accepts column names only.
-- So we expose the whole query — `websearch_to_tsquery` + `ts_rank_cd`
-- ranking + `ts_headline` snippet — as a single SECURITY DEFINER RPC, the
-- same pattern as 0004 (view_count_rpc) and 0009 (feed_shortlist).
--
-- Optional filters:
--   • p_type        — narrow to one of {post,playbook,dive}; NULL = any.
--   • p_tag_slugs   — match posts tagged with ANY of these slugs; NULL = any.
--
-- The function only reads `public.posts` and `public.post_tags`, which are
-- already public-readable under RLS for non-deleted, published rows. The
-- elevated grant doesn't widen any attack surface — it just lets us layer
-- the ranking expression PostgREST can't.
--
-- Empty/whitespace `p_q` produces an empty tsquery via `websearch_to_tsquery`
-- which matches nothing; that's intentional. The page short-circuits empty
-- queries client-side before they ever hit the RPC, but the RPC stays
-- correct under direct calls too.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_posts(
    p_q text,
    p_limit integer DEFAULT 50,
    p_type text DEFAULT NULL,
    p_tag_slugs text[] DEFAULT NULL
)
RETURNS TABLE (
    id              uuid,
    author_id       uuid,
    type            text,
    slug            text,
    title           text,
    summary         text,
    snippet         text,
    published_at    timestamptz,
    like_count      integer,
    bookmark_count  integer,
    comment_count   integer,
    rank            real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH q AS (
        SELECT websearch_to_tsquery('english', coalesce(p_q, '')) AS tsq
    )
    SELECT
        p.id,
        p.author_id,
        p.type,
        p.slug,
        p.title,
        p.summary,
        ts_headline(
            'english',
            p.summary,
            (SELECT tsq FROM q),
            'MaxFragments=2,MaxWords=20,MinWords=5,StartSel=<mark>,StopSel=</mark>'
        ) AS snippet,
        p.published_at,
        p.like_count,
        p.bookmark_count,
        p.comment_count,
        ts_rank_cd(p.search_tsv, (SELECT tsq FROM q)) AS rank
    FROM public.posts p
    WHERE p.deleted_at IS NULL
      AND p.published_at <= now()
      AND p.search_tsv @@ (SELECT tsq FROM q)
      AND (p_type IS NULL OR p.type = p_type)
      AND (
        p_tag_slugs IS NULL
        OR EXISTS (
            SELECT 1 FROM public.post_tags pt
            WHERE pt.post_id = p.id AND pt.tag_slug = ANY(p_tag_slugs)
        )
      )
    ORDER BY rank DESC, p.published_at DESC, p.id DESC
    LIMIT GREATEST(p_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_posts(text, integer, text, text[])
    TO anon, authenticated, service_role;
