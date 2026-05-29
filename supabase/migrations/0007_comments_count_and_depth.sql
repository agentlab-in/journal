-- =============================================================================
-- Migration 0007 — Comment count denormalization + depth lookup RPC
--
-- Two pieces of bookkeeping that keep the comments feature cheap to read:
--
--   1. posts.comment_count is denormalized. Listing posts on the homepage,
--      profile pages, and search results would otherwise need a correlated
--      subquery per row. The trigger keeps the count consistent across
--      INSERT, soft-delete (UPDATE deleted_at NULL↔NOT NULL), and hard DELETE
--      without any application-layer plumbing — the DB is the single source
--      of truth.
--
--   2. comment_depth_for_parent(p_parent) walks the parent_comment_id chain
--      in a recursive CTE so the API can enforce the depth-5 cap in ONE
--      round-trip instead of N self-joins or N separate queries. Returning
--      the parent's depth (= count of ancestors INCLUDING the parent itself,
--      1-indexed) lets the caller compute the new comment's depth as
--      parent_depth + 1 and reject early.
--
-- Both functions are SECURITY DEFINER with a locked search_path, matching
-- the pattern from 0004_view_count_rpc.sql.
-- =============================================================================

ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS comment_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.handle_comment_count_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        IF NEW.deleted_at IS NULL THEN
            UPDATE public.posts
            SET comment_count = comment_count + 1
            WHERE id = NEW.post_id;
        END IF;
        RETURN NULL;
    ELSIF (TG_OP = 'DELETE') THEN
        IF OLD.deleted_at IS NULL THEN
            UPDATE public.posts
            SET comment_count = comment_count - 1
            WHERE id = OLD.post_id;
        END IF;
        RETURN NULL;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
            UPDATE public.posts
            SET comment_count = comment_count - 1
            WHERE id = NEW.post_id;
        ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
            UPDATE public.posts
            SET comment_count = comment_count + 1
            WHERE id = NEW.post_id;
        END IF;
        RETURN NULL;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS comments_count_trigger ON public.comments;

CREATE TRIGGER comments_count_trigger
AFTER INSERT OR UPDATE OF deleted_at OR DELETE ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.handle_comment_count_change();

-- Returns NULL when p_parent doesn't exist (caller treats as parent_not_found).
-- The CYCLE clause bounds termination defensively: the FK on
-- parent_comment_id alone does not prevent id = parent_comment_id self-cycles
-- or multi-row cycles, so we ask Postgres to detect any repeated node in the
-- walk and stop. Requires Postgres 14+ (Supabase ships 15+).
CREATE OR REPLACE FUNCTION public.comment_depth_for_parent(p_parent uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_comment_id FROM public.comments WHERE id = p_parent
    UNION ALL
    SELECT c.id, c.parent_comment_id
    FROM public.comments c
    JOIN chain ch ON c.id = ch.parent_comment_id
  )
  CYCLE id SET is_cycle USING path
  SELECT NULLIF(count(*)::integer, 0) FROM chain WHERE NOT is_cycle;
$$;

GRANT EXECUTE ON FUNCTION public.comment_depth_for_parent(uuid)
    TO anon, authenticated, service_role;

UPDATE public.posts p
SET comment_count = (
    SELECT count(*)
    FROM public.comments c
    WHERE c.post_id = p.id AND c.deleted_at IS NULL
);
