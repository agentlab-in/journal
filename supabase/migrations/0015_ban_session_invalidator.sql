-- =============================================================================
-- 0015_ban_session_invalidator.sql
-- Pre-launch security hardening (W4) — ban enforcement primitives.
--
--   1. invalidate_sessions_on_ban() trigger
--      Atomically deletes next_auth.sessions for a user the moment
--      public.users.banned_at flips from NULL → non-NULL. Replaces the
--      app-level DELETE in /api/admin/ban, which was non-transactional
--      with the UPDATE and silently swallowed errors.
--
--   2. public.ban_fingerprints
--      Persists the email hash + GitHub providerAccountId of every banned
--      user so a re-ban-evasion attempt with a second GitHub account can
--      be denied at the signIn callback. email_hash is sha256(lower(email))
--      computed in app code; we never store raw emails.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Session-invalidator trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invalidate_sessions_on_ban()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, next_auth
AS $$
BEGIN
  IF NEW.banned_at IS NOT NULL
     AND (OLD.banned_at IS NULL OR OLD.banned_at IS DISTINCT FROM NEW.banned_at)
  THEN
    DELETE FROM next_auth.sessions WHERE "userId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_invalidate_sessions_on_ban ON public.users;
CREATE TRIGGER users_invalidate_sessions_on_ban
  AFTER UPDATE OF banned_at ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_sessions_on_ban();

-- ---------------------------------------------------------------------------
-- 2. ban_fingerprints — re-ban-evasion lookup table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ban_fingerprints (
    email_hash           text PRIMARY KEY,
    provider_account_id  text,
    user_id              uuid REFERENCES public.users (id) ON DELETE SET NULL,
    banned_at            timestamptz NOT NULL DEFAULT now()
);

-- Secondary lookup for the providerAccountId path (a banned user signing in
-- with a different email but the same GitHub account).
CREATE INDEX IF NOT EXISTS ban_fingerprints_provider_account_id_idx
    ON public.ban_fingerprints (provider_account_id)
    WHERE provider_account_id IS NOT NULL;

-- Service-role only; no RLS policies are needed because RLS is enforced
-- via the existing project-level default-deny. All reads/writes go through
-- createAdminSupabaseClient.
ALTER TABLE public.ban_fingerprints ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.ban_fingerprints TO postgres;
GRANT ALL ON TABLE public.ban_fingerprints TO service_role;
