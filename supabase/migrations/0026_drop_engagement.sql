-- =============================================================================
-- 0026_drop_engagement.sql
-- Remove engagement layer (issue #85).
--
-- agentlab.in became a gated invite-only showcase: reads are public, only
-- manually approved people can write, and there is no more comments/likes/
-- bookmarks/follows/view-count/heat-ranking surface. The stacked app-side
-- branch (remove-engagement-app) already removed every read/write of this
-- schema, so this migration drops it outright. The app PR deploys first;
-- this migration runs after, so nothing live reads these objects when they
-- go away.
--
-- Drops (in dependency order):
--   1. Guard-rail DELETEs: reports/mod_actions rows with target_type =
--      'comment'. These reference a table (public.comments) that is about
--      to disappear, and the narrowed CHECK constraints below would reject
--      re-adding the constraint while these rows still exist.
--   2. Tables: public.likes, public.comments, public.bookmarks,
--      public.follows (CASCADE: comments is referenced by
--      mod_actions.target_comment_id (0020), and CASCADE also takes each
--      table's own RLS policies and the four *_require_approved triggers
--      from 0024 that were owned by these tables).
--   3. Columns: posts.view_count/like_count/bookmark_count/comment_count,
--      users.follower_count/following_count, mod_actions.target_comment_id.
--   4. Functions: increment_post_view_count (0004), comment_depth_for_parent
--      and handle_comment_count_change (0007), feed_shortlist_by_heat (0009),
--      handle_like_count_change / handle_bookmark_count_change /
--      handle_follow_count_change (0008). Their triggers are already gone
--      with the tables in step 2, so nothing depends on them here.
--   5. CHECK narrowing: reports.target_type drops both 'comment' and 'org'
--      (org-target reporting was already retired from the app in an earlier
--      commit on this branch: lib/reports/schema.ts's ReportCreateBody enum
--      is 'post' | 'user'). mod_actions.target_type only drops 'comment';
--      'org' stays live (app/api/admin/orgs/ban and unban still write it).
--   6. search_posts (0010) is dropped and recreated without the
--      like_count/bookmark_count/comment_count return columns; grants are
--      preserved exactly.
--
-- Not touched: the 0023 posts_published_idx index, the 0024
-- posts/reports/pinned_posts *_require_approved triggers, require_approved_
-- user, enforce_author_approved, resolve_session_gate.
--
-- Note: 0025_public_launch_hardening.sql's `REVOKE EXECUTE ON FUNCTION
-- public.increment_post_view_count(uuid) FROM anon` becomes moot once step 4
-- drops the function below; nothing to undo, the grant just ceases to exist
-- along with the function.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Guard-rail deletes: comment-target rows in reports/mod_actions.
--
-- Must run before the CHECK-narrowing in step 5: ADD CONSTRAINT validates
-- against existing rows, so any surviving target_type = 'comment' row would
-- fail the narrowed CHECK.
-- ---------------------------------------------------------------------------
DELETE FROM public.reports WHERE target_type = 'comment';
DELETE FROM public.mod_actions WHERE target_type = 'comment';

-- ---------------------------------------------------------------------------
-- 2. Drop tables.
--
-- CASCADE: public.comments is referenced by mod_actions.target_comment_id
-- (FK added in 0020_misc_hardening.sql); CASCADE drops that FK constraint
-- along with the table. It also takes each table's RLS policies and the
-- likes_require_approved / bookmarks_require_approved / follows_require_
-- approved / comments_require_approved triggers from 0024_approved_users.sql,
-- none of which have any purpose once the owning table is gone.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.likes CASCADE;
DROP TABLE IF EXISTS public.comments CASCADE;
DROP TABLE IF EXISTS public.bookmarks CASCADE;
DROP TABLE IF EXISTS public.follows CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Drop columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts DROP COLUMN IF EXISTS view_count;
ALTER TABLE public.posts DROP COLUMN IF EXISTS like_count;
ALTER TABLE public.posts DROP COLUMN IF EXISTS bookmark_count;
ALTER TABLE public.posts DROP COLUMN IF EXISTS comment_count;

ALTER TABLE public.users DROP COLUMN IF EXISTS follower_count;
ALTER TABLE public.users DROP COLUMN IF EXISTS following_count;

ALTER TABLE public.mod_actions DROP COLUMN IF EXISTS target_comment_id;

-- ---------------------------------------------------------------------------
-- 4. Drop functions.
--
-- Each function's trigger was dropped along with its table in step 2, so
-- nothing depends on these anymore.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.increment_post_view_count(uuid);
DROP FUNCTION IF EXISTS public.comment_depth_for_parent(uuid);
DROP FUNCTION IF EXISTS public.handle_comment_count_change();
DROP FUNCTION IF EXISTS public.feed_shortlist_by_heat(integer);
DROP FUNCTION IF EXISTS public.handle_like_count_change();
DROP FUNCTION IF EXISTS public.handle_bookmark_count_change();
DROP FUNCTION IF EXISTS public.handle_follow_count_change();

-- ---------------------------------------------------------------------------
-- 5. Narrow CHECK constraints.
--
-- reports.target_type: was ('post', 'comment', 'user', 'org') as of 0017.
-- Drops to ('post', 'user'): 'comment' per this migration, 'org' was
-- already retired from the report-creation API on this branch.
--
-- mod_actions.target_type: was ('post', 'comment', 'user', 'tag', 'report',
-- 'org') as of 0017. Drops only 'comment'; org/tag/report moderation
-- actions are unaffected by the engagement-layer removal.
-- ---------------------------------------------------------------------------
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_target_type_check
    CHECK (target_type IN ('post', 'user'));

ALTER TABLE public.mod_actions DROP CONSTRAINT IF EXISTS mod_actions_target_type_check;
ALTER TABLE public.mod_actions ADD CONSTRAINT mod_actions_target_type_check
    CHECK (target_type IN ('post', 'user', 'tag', 'report', 'org'));

-- ---------------------------------------------------------------------------
-- 6. Recreate search_posts without the engagement count columns.
--
-- RETURNS TABLE column set is changing, so CREATE OR REPLACE is not enough
-- (Postgres rejects a return-type change on REPLACE): drop first, then
-- create. Grants are re-issued identically to 0010_search_posts_rpc.sql.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_posts(text, integer, text, text[]);

CREATE FUNCTION public.search_posts(
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
