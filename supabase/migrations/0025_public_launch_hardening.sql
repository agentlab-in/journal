-- =============================================================================
-- 0025_public_launch_hardening.sql
-- Incidental security findings from the go-public audit (Phase 5).
--   F4  Close the direct anon-PostgREST write path on the view-count RPC.
--   F11 Mirror the read RPCs: a scheduled (future published_at) post must not
--       be readable via direct anon PostgREST.
--   F12 Drop the dead unconditional users read policy so users_public is the
--       sole anon read path (a stray future GRANT then cannot re-expose ban
--       state / signup_flags).
--
-- Invariant reminder (F6): never GRANT USAGE ON SCHEMA next_auth TO anon, and
-- every new public table must ENABLE RLS with no anon policy. 0003's default
-- privileges auto-grant anon SELECT on new public tables, so RLS is the only
-- filter.
-- =============================================================================

-- F4: legitimate view counting goes through the service-role client
-- (app/api/posts/[id]/view/route.ts), which bypasses this revoke; only the
-- direct anon PostgREST path is closed.
REVOKE EXECUTE ON FUNCTION public.increment_post_view_count(uuid) FROM anon;

-- F11: reproduce the 0017 posts public-read policy and add published_at <= now()
-- so a future-dated post is not directly readable via the anon key.
DROP POLICY IF EXISTS "posts: public read non-deleted" ON public.posts;
CREATE POLICY "posts: public read non-deleted"
    ON public.posts
    FOR SELECT
    TO anon, authenticated
    USING (
        deleted_at IS NULL
        AND published_at <= now()
        AND (
            org_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.orgs o
                WHERE o.id = posts.org_id
                  AND o.deleted_at IS NULL
                  AND o.banned_at IS NULL
            )
        )
    );

-- F12: the users_public view (0014) is the only anon read path; drop the dead
-- unconditional table policy so a future GRANT cannot re-expose ban columns.
DROP POLICY IF EXISTS "users: public read" ON public.users;
