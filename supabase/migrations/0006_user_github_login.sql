-- =============================================================================
-- 0006_user_github_login.sql — mirror github_login into public.users
--
-- public.users.username is already populated as lower(NEW.github_login) by the
-- sync trigger from 0002_content.sql, but Phase 6 surfaces the GitHub link on
-- the profile page (`https://github.com/<github_login>`). Lowercase usernames
-- work behaviorally (GitHub is case-insensitive in URLs), but we lose the
-- original casing — useful for future display / copy-to-clipboard surfaces.
--
-- This migration:
--   1. Adds public.users.github_login (original case) + an index for lookups.
--   2. Backfills existing rows from next_auth.users.github_login.
--   3. Replaces the sync_user_from_next_auth() function body so it writes
--      github_login on INSERT and refreshes it on subsequent UPDATEs to the
--      next_auth.users.github_login column (the trigger already fires on
--      AFTER INSERT OR UPDATE OF github_login, so the existing CREATE TRIGGER
--      stays as-is).
--
-- Idempotent: safe to re-run against an already-applied DB (`supabase db reset`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column + index
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS github_login text;

CREATE INDEX IF NOT EXISTS users_github_login_idx
    ON public.users (github_login);

-- ---------------------------------------------------------------------------
-- 2. Backfill from next_auth.users for rows that already exist
-- ---------------------------------------------------------------------------
UPDATE public.users pu
SET github_login = nau.github_login
FROM next_auth.users nau
WHERE nau.id = pu.id
  AND nau.github_login IS NOT NULL
  AND pu.github_login IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Replace sync_user_from_next_auth()
--
-- The function previously inserted (id, username, display_name, avatar_url)
-- and did ON CONFLICT (id) DO NOTHING to preserve immutability of
-- display_name / username after first sync.
--
-- We now also write github_login on INSERT, and on CONFLICT we update only
-- github_login (so a user changing their GitHub login casing gets refreshed
-- without clobbering display_name or username, which remain immutable).
-- The trigger itself fires on AFTER INSERT OR UPDATE OF github_login, so
-- both events route through this single function body.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_user_from_next_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.github_login IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.users (id, username, display_name, avatar_url, github_login)
    VALUES (
        NEW.id,
        lower(NEW.github_login),
        COALESCE(NEW.name, NEW.github_login),
        NEW.image,
        NEW.github_login
    )
    ON CONFLICT (id) DO UPDATE
        SET github_login = EXCLUDED.github_login;

    RETURN NEW;
END;
$$;
