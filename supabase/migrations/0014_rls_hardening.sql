-- =============================================================================
-- 0014_rls_hardening.sql
-- Pre-launch hardening — security audit C1, C7.
--
-- Three independent fixes bundled because all three are RLS / GRANT changes
-- on existing tables and they ship together:
--
--   1. (C1) public.users has accumulated sensitive columns since 0002 —
--      banned_at, banned_reason, banned_by (0011), signup_flags (0012).
--      The `users_public_read` policy is FOR SELECT USING (true), and the
--      column-level GRANT to anon/authenticated was never narrowed. Anyone
--      with the publishable anon key can read every user's ban state and
--      heuristic-flag bag.
--
--      Fix: create a security_invoker view `public.users_public` exposing
--      only the public columns and revoke the underlying table GRANT from
--      the anon/authenticated roles. Service-role retains full access via
--      its bypass of column GRANTs (and we explicitly grant it for clarity).
--
--   2. (C7) public.pinned_posts SELECT policy is unconditional — it leaks
--      pin rows whose parent post has been soft-deleted (deleted_at set).
--      The pin row itself is low-value, but the post_id leak lets a probe
--      enumerate moderation-deleted post UUIDs.
--
--      Fix: gate the policy on the parent post being non-deleted, mirroring
--      the pattern used by post_tags in 0002_content.sql.
--
--   3. (C7) public.comments SELECT policy filters the comment's own
--      deleted_at but not the parent post's deleted_at. A comment on a
--      soft-deleted post stays visible.
--
--      Fix: extend the policy with a parent-post non-deleted check (same
--      pattern as #2).
--
-- All changes are additive (no DROP COLUMN). The two policy rewrites use
-- DROP + CREATE because Postgres has no ALTER POLICY ... USING form.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. (C1) public.users_public — safe projection for anon/authenticated reads
--
-- WITH (security_invoker = true) — the view executes with the calling
-- role's privileges, so RLS on public.users still applies when the view
-- is queried. The GRANT below is the actual access control; the
-- security_invoker setting is defense-in-depth so a future GRANT mistake
-- on the view doesn't accidentally elevate readers above the table policy.
--
-- Column list mirrors what app/[username]/page.tsx, lib/profile/lookup.ts,
-- and lib/feed/hydrate.ts already select; nothing private creeps through.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.users_public;

CREATE VIEW public.users_public
    WITH (security_invoker = true)
    AS
    SELECT
        id,
        username,
        display_name,
        bio,
        avatar_url,
        github_login,
        follower_count,
        following_count,
        created_at
    FROM public.users;

COMMENT ON VIEW public.users_public IS
    'Safe projection of public.users for anon/authenticated readers. '
    'Excludes banned_at, banned_reason, banned_by (0011), signup_flags (0012), '
    'updated_at, and email-bearing columns. Anon/authenticated clients should '
    'always query this view instead of the underlying table. '
    'Service-role bypasses both the view and the underlying GRANT.';

REVOKE ALL ON public.users_public FROM anon, authenticated;
GRANT SELECT ON public.users_public TO anon, authenticated;

-- Narrow the underlying-table GRANT. Service-role bypasses column GRANTs
-- entirely; the postgres / supabase_admin / supabase_auth_admin roles keep
-- the access they had via membership (the migration writer role inherits
-- postgres). The existing "users: public read" RLS policy stays in place
-- as belt-and-braces — once the table GRANT is gone, the policy can't be
-- exercised by anon/authenticated anyway.
REVOKE SELECT ON public.users FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. (C7) public.pinned_posts — gate SELECT on parent post non-deletion
--
-- Pattern mirrors `post_tags: public read` from 0002_content.sql:492-502:
-- EXISTS subquery joins on posts and requires p.deleted_at IS NULL.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "pinned_posts: public read" ON public.pinned_posts;

CREATE POLICY "pinned_posts: public read"
    ON public.pinned_posts
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = pinned_posts.post_id
              AND p.deleted_at IS NULL
        )
    );

-- ---------------------------------------------------------------------------
-- 3. (C7) public.comments — also gate on parent post non-deletion
--
-- The existing "comments: public read non-deleted" policy already filters
-- the comment's own deleted_at. Extend it so a comment whose parent post
-- was soft-deleted is no longer visible. The companion
-- "comments: author reads own deleted" policy (which lets an author see
-- their own soft-deleted comments) stays untouched — that's about the
-- comment's own deleted_at, orthogonal to the parent post's state.
--
-- We keep the policy name unchanged so future audits can grep for it.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "comments: public read non-deleted" ON public.comments;

CREATE POLICY "comments: public read non-deleted"
    ON public.comments
    FOR SELECT
    TO anon, authenticated
    USING (
        deleted_at IS NULL
        AND EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = comments.post_id
              AND p.deleted_at IS NULL
        )
    );
