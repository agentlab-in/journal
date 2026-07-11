-- =============================================================================
-- 0024_approved_users.sql
-- Public-launch approval gate (Phase 1).
--
-- Nobody may register (obtain a session) or write unless their GitHub login
-- is in public.approved_users. Approval happens out-of-band by email; the
-- owner inserts a row only after the applicant replies "I agree to the terms
-- at agentlab.in/terms".
--
-- Enforcement is by TRIGGER, not RLS: every write in this app goes through
-- the service_role client, which BYPASSES RLS regardless of policy content.
-- Triggers fire for every role including service_role, so they are the only
-- DB primitive that can gate a service-role-authored write. Pattern mirrors
-- prevent_consents_mutation (0022) and invalidate_sessions_on_ban (0015).
--
-- Keyed by github_login (lowercase), NOT by users.id: the owner approves a
-- login before that person has ever signed in, so no uuid exists yet.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.approved_users (
  github_login      text PRIMARY KEY CHECK (github_login = lower(github_login)),
  approved_at       timestamptz NOT NULL DEFAULT now(),
  -- Truthful only. Set ONLY on a genuine "I agree to the terms at
  -- agentlab.in/terms" email reply for this applicant. NEVER backfill this
  -- from public.consents (0022): that ceremony agreed to different documents,
  -- so copying it here would manufacture a false acceptance record. Do not
  -- reintroduce a synthetic timestamp in any future edit.
  terms_accepted_at timestamptz,
  approved_by       text NOT NULL DEFAULT 'harshit@agentlab.in',
  notes             text
);

ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;

-- Service-role only. No anon/authenticated policy: nothing client-side reads
-- the allow-list, and exposing who is approved would leak PII-adjacent data.
CREATE POLICY "approved_users: service_role full access"
  ON public.approved_users FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.approved_users TO service_role;
-- 0003's ALTER DEFAULT PRIVILEGES auto-grants anon/authenticated SELECT on new
-- public tables; strip it so the allow-list is never anon-readable.
REVOKE ALL ON TABLE public.approved_users FROM anon, authenticated;

-- Clean slate: seed owner/admins ONLY. No grandfather backfill of existing
-- users. Parameterize this login list to match ADMIN_GITHUB_LOGINS at cutover.
-- The owner row's terms_accepted_at = now() is truthful (owner authored terms).
INSERT INTO public.approved_users (github_login, approved_at, terms_accepted_at, approved_by)
VALUES ('harshitsinghbhandari', now(), now(), 'system:owner-seed')
ON CONFLICT (github_login) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Membership check, reused by every trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.require_approved_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_login text;
BEGIN
  SELECT lower(github_login) INTO v_login FROM public.users WHERE id = p_user_id;
  IF v_login IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.approved_users WHERE github_login = v_login
  ) THEN
    RAISE EXCEPTION 'writer not approved: %', p_user_id USING ERRCODE = '42501';
  END IF;
END; $$;

-- Generic BEFORE INSERT gate. owner_col is supplied only by TG_ARGV, which is
-- FIXED in the CREATE TRIGGER DDL below; no runtime or user-supplied input ever
-- reaches the dynamic format() SQL, and search_path is pinned to public,
-- pg_temp, so the %I interpolation is not an injection surface.
CREATE OR REPLACE FUNCTION public.enforce_author_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner_col text := TG_ARGV[0]; owner_id uuid;
BEGIN
  EXECUTE format('SELECT ($1).%I', owner_col) INTO owner_id USING NEW;
  PERFORM public.require_approved_user(owner_id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS posts_require_approved ON public.posts;
CREATE TRIGGER posts_require_approved BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_approved('author_id');

DROP TRIGGER IF EXISTS comments_require_approved ON public.comments;
CREATE TRIGGER comments_require_approved BEFORE INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_approved('author_id');

DROP TRIGGER IF EXISTS likes_require_approved ON public.likes;
CREATE TRIGGER likes_require_approved BEFORE INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_approved('user_id');

DROP TRIGGER IF EXISTS bookmarks_require_approved ON public.bookmarks;
CREATE TRIGGER bookmarks_require_approved BEFORE INSERT ON public.bookmarks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_approved('user_id');

DROP TRIGGER IF EXISTS follows_require_approved ON public.follows;
CREATE TRIGGER follows_require_approved BEFORE INSERT ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_approved('follower_id');

DROP TRIGGER IF EXISTS reports_require_approved ON public.reports;
CREATE TRIGGER reports_require_approved BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_approved('reporter_id');

DROP TRIGGER IF EXISTS pinned_posts_require_approved ON public.pinned_posts;
CREATE TRIGGER pinned_posts_require_approved BEFORE INSERT ON public.pinned_posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_approved('user_id');

-- ---------------------------------------------------------------------------
-- Single-round-trip session gate: reads banned_at AND approval in one
-- statement so getSession() replaces its ban-only query with one rpc() call,
-- adding zero round-trips (India-region RTT is the worst-measured surface).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_session_gate(p_user_id uuid)
RETURNS TABLE (banned_at timestamptz, is_approved boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    u.banned_at,
    EXISTS (
      SELECT 1 FROM public.approved_users a
      WHERE a.github_login = lower(u.github_login)
    ) AS is_approved
  FROM public.users u
  WHERE u.id = p_user_id;
$$;

-- Server-only (getSession via service-role client). Do NOT grant to
-- anon/authenticated; REVOKE from PUBLIC to avoid the default-execute footgun.
REVOKE ALL ON FUNCTION public.resolve_session_gate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_session_gate(uuid) TO service_role;
