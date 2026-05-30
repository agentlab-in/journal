-- =============================================================================
-- Migration 0008 — Engagement count denormalization (likes, bookmarks, follows)
--
-- Same shape as 0007_comments_count_and_depth.sql: a small set of denormalized
-- counters on posts/users kept consistent by AFTER-row triggers, so reads
-- (homepage, profile pages, search results, ranking) don't need correlated
-- subqueries or COUNT(*) over the join tables.
--
--   1. posts.like_count, posts.bookmark_count — driven by INSERT/DELETE on
--      public.likes / public.bookmarks. These join tables have no soft-delete
--      semantics (composite PK + hard delete), so the trigger logic is a
--      simpler INSERT/DELETE branch only.
--
--   2. users.follower_count, users.following_count — both sides incremented
--      by a single trigger on public.follows. follower_count tracks the
--      followed user's inbound edges; following_count tracks the follower's
--      outbound edges. The follows_no_self_follow CHECK (migration 0002)
--      means each row mutates exactly two distinct user rows.
--
-- All trigger functions are SECURITY DEFINER with a locked search_path,
-- matching the pattern from 0004_view_count_rpc.sql and 0007.
-- =============================================================================

ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS bookmark_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS follower_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS following_count integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- like_count trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_like_count_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE public.posts
        SET like_count = like_count + 1
        WHERE id = NEW.post_id;
        RETURN NULL;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE public.posts
        SET like_count = like_count - 1
        WHERE id = OLD.post_id;
        RETURN NULL;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS likes_count_trigger ON public.likes;

CREATE TRIGGER likes_count_trigger
AFTER INSERT OR DELETE ON public.likes
FOR EACH ROW
EXECUTE FUNCTION public.handle_like_count_change();

-- ---------------------------------------------------------------------------
-- bookmark_count trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_bookmark_count_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE public.posts
        SET bookmark_count = bookmark_count + 1
        WHERE id = NEW.post_id;
        RETURN NULL;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE public.posts
        SET bookmark_count = bookmark_count - 1
        WHERE id = OLD.post_id;
        RETURN NULL;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS bookmarks_count_trigger ON public.bookmarks;

CREATE TRIGGER bookmarks_count_trigger
AFTER INSERT OR DELETE ON public.bookmarks
FOR EACH ROW
EXECUTE FUNCTION public.handle_bookmark_count_change();

-- ---------------------------------------------------------------------------
-- follower_count / following_count trigger (single function, both sides)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_follow_count_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE public.users
        SET follower_count = follower_count + 1
        WHERE id = NEW.followed_id;
        UPDATE public.users
        SET following_count = following_count + 1
        WHERE id = NEW.follower_id;
        RETURN NULL;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE public.users
        SET follower_count = follower_count - 1
        WHERE id = OLD.followed_id;
        UPDATE public.users
        SET following_count = following_count - 1
        WHERE id = OLD.follower_id;
        RETURN NULL;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS follows_count_trigger ON public.follows;

CREATE TRIGGER follows_count_trigger
AFTER INSERT OR DELETE ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.handle_follow_count_change();

-- ---------------------------------------------------------------------------
-- Backfill from existing rows.
-- ---------------------------------------------------------------------------
UPDATE public.posts p
SET like_count = (
    SELECT count(*)
    FROM public.likes l
    WHERE l.post_id = p.id
);

UPDATE public.posts p
SET bookmark_count = (
    SELECT count(*)
    FROM public.bookmarks b
    WHERE b.post_id = p.id
);

UPDATE public.users u
SET follower_count = (
        SELECT count(*)
        FROM public.follows f
        WHERE f.followed_id = u.id
    ),
    following_count = (
        SELECT count(*)
        FROM public.follows f
        WHERE f.follower_id = u.id
    );
