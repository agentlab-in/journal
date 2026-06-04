-- =============================================================================
-- Migration 0020 — Misc M/L hardening (security audit 2026-06-01)
--
-- Bundles four loosely-related fixes from the security audit:
--
--   M4  mod_actions typed target columns
--   M5  post_versions version_no race + advisory-locked monotonic counter
--   M8  SECURITY DEFINER RPC grants — minimum necessary
--   L13 next_auth.verification_tokens belt-and-braces REVOKE
--
-- Each section is independently re-runnable so the migration can be applied
-- forward (and partially rolled back by hand) without a separate teardown.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- M4. mod_actions: add typed target_* columns alongside the legacy
--     `target_id text` column.
--
-- The existing string-typed column has no FK and silently survives the
-- deletion of the referenced row, which is an integrity hazard for the
-- moderation audit trail. We don't drop it — existing app code still writes
-- it — but we add typed columns the new code path can adopt incrementally.
--
-- Constraint: at most ONE of the typed columns may be non-null per row.
-- Legacy rows (where target_id is set and all typed cols are NULL) pass.
-- We add the constraint NOT VALID so existing rows aren't re-checked; new
-- INSERT/UPDATEs are validated.
--
-- TODO (follow-up PR): backfill typed columns from target_id + target_type;
-- update app/api/admin/** route handlers to write the typed column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.mod_actions
    ADD COLUMN IF NOT EXISTS target_post_id    uuid REFERENCES public.posts(id)    ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS target_user_id    uuid REFERENCES public.users(id)    ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS target_comment_id uuid REFERENCES public.comments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS target_tag_slug   text REFERENCES public.tags(slug)   ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'mod_actions_target_single_typed'
    ) THEN
        ALTER TABLE public.mod_actions
            ADD CONSTRAINT mod_actions_target_single_typed
            CHECK (
                num_nonnulls(target_post_id, target_user_id, target_comment_id, target_tag_slug) <= 1
            ) NOT VALID;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS mod_actions_target_post_idx
    ON public.mod_actions (target_post_id) WHERE target_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mod_actions_target_user_idx
    ON public.mod_actions (target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mod_actions_target_comment_idx
    ON public.mod_actions (target_comment_id) WHERE target_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mod_actions_target_tag_idx
    ON public.mod_actions (target_tag_slug) WHERE target_tag_slug IS NOT NULL;


-- ---------------------------------------------------------------------------
-- M5. post_versions: serialize version_no assignment in the DB.
--
-- Old shape: callers compute `next = max(version_no) + 1` in app code and
-- pass it as part of the INSERT. Two concurrent draft-saves on the same
-- post can both read the same max and INSERT identical version_no rows;
-- only the (post_id, version_no) PK prevents corruption, and the loser
-- gets a 23505 instead of a successful save.
--
-- New shape: a BEFORE INSERT trigger overrides whatever value the caller
-- supplied with `max(version_no) + 1` computed under a per-post advisory
-- transaction lock. Concurrent inserts on the SAME post serialize; inserts
-- on DIFFERENT posts run in parallel. The lock auto-releases at COMMIT or
-- ROLLBACK so a failing INSERT doesn't strand the lock.
--
-- TODO (follow-up PR, owned by W5 / posts route): remove the now-unused
-- client-side `version_no` computation at app/api/posts/[id]/route.ts:171-175.
-- The trigger silently overrides the client value, so behavior is correct
-- in the interim — cleanup is cosmetic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_post_version_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('post_version:' || NEW.post_id::text));
    NEW.version_no := coalesce(
        (SELECT max(version_no) FROM public.post_versions WHERE post_id = NEW.post_id),
        0
    ) + 1;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS post_versions_set_version_no ON public.post_versions;
CREATE TRIGGER post_versions_set_version_no
    BEFORE INSERT ON public.post_versions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_post_version_no();


-- ---------------------------------------------------------------------------
-- M8. SECURITY DEFINER RPC grants — minimum necessary.
--
-- The three SECURITY DEFINER RPCs (search_posts, increment_post_view_count,
-- comment_depth_for_parent) all currently grant EXECUTE to anon. Review:
--
--   search_posts              KEEP anon — unauthenticated /search uses it.
--   increment_post_view_count KEEP anon — unauthenticated post view beacon.
--   comment_depth_for_parent  REVOKE anon — only called from auth routes
--                                            (POST /api/comments). Reduces
--                                            attack surface against the
--                                            recursive CTE if it ever has a
--                                            bug.
--
-- service_role retains EXECUTE on all three (it inherits via the default
-- public grant and the explicit grants in 0004/0007/0010).
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.comment_depth_for_parent(uuid) FROM anon;


-- ---------------------------------------------------------------------------
-- L13. next_auth.verification_tokens belt-and-braces REVOKE.
--
-- The NextAuth Supabase adapter creates this table for email-link sign-in;
-- we don't use email login, but the table exists. Audit couldn't confirm
-- the adapter set REVOKE for anon/authenticated. This statement is a no-op
-- if the adapter already did it correctly.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'next_auth' AND table_name = 'verification_tokens'
    ) THEN
        REVOKE ALL ON next_auth.verification_tokens FROM anon, authenticated;
    END IF;
END$$;
