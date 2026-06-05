-- =============================================================================
-- 0022_consents.sql
-- Issue #57 — Consent gate at signup.
--
-- Append-only audit log of user consent to the four legal docs:
--   - 18+ self-confirmation (age_confirmed)
--   - Terms of Service (terms_version)
--   - Content Policy (content_policy_version)
--   - Privacy Policy (privacy_policy_version)
--
-- One row per user per version-triple — when any version bumps and the user
-- re-confirms, a new row is inserted; the prior row is retained for audit.
-- IP and user agent are captured at submission time for evidentiary value
-- in any future dispute.
--
-- Versions are managed in code (lib/legal/versions.ts), not DB.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  consented_at timestamptz NOT NULL DEFAULT now(),
  -- The 18+ box is a hard requirement: the server action only inserts
  -- when all four boxes are true, and consent-guard reads only the version
  -- triple, so an `age_confirmed = false` row would silently pass the gate.
  -- The CHECK constraint blocks that path at the DB even if a future
  -- writer (admin script, migration) forgets the contract.
  age_confirmed boolean NOT NULL CONSTRAINT consents_age_confirmed_check CHECK (age_confirmed IS TRUE),
  terms_version text NOT NULL,
  content_policy_version text NOT NULL,
  privacy_policy_version text NOT NULL,
  ip_address text,
  user_agent text
);

-- Prevent duplicate rows for the same user + version-triple.
CREATE UNIQUE INDEX IF NOT EXISTS consents_user_versions_uniq
  ON public.consents (user_id, terms_version, content_policy_version, privacy_policy_version);

-- Latest-consent lookup is the hot read path (per-request consent check).
CREATE INDEX IF NOT EXISTS consents_user_latest_idx
  ON public.consents (user_id, consented_at DESC);

ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;

-- Users can read their own consent rows (powers the /settings/profile snapshot).
CREATE POLICY consents_self_read ON public.consents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policy: only the service role (server actions)
-- writes to this table. Defence-in-depth against client-side forging.

-- Append-only enforcement: RLS alone doesn't cover service_role, so a
-- direct UPDATE/DELETE from a future server action would silently mutate
-- the audit trail. The trigger raises on every UPDATE and DELETE so the
-- log is immutable even from privileged paths. The ON DELETE CASCADE on
-- user_id is intentionally exempted (deleting a user must still wipe
-- their rows under DPDP §12 erasure rights); the trigger checks for the
-- CASCADE context via the session_replication_role mechanism is brittle,
-- so instead we allow row-level CASCADE deletes implicitly by attaching
-- the trigger to UPDATE only, and emulate the "no manual DELETE" rule
-- through process discipline + the RLS absence of a DELETE policy. RLS
-- DOES apply to a direct DELETE from the service role only if the DELETE
-- is issued via PostgREST with the authenticated role; the service-role
-- key bypasses RLS, but we don't have any code path that issues a manual
-- DELETE against public.consents — the only deletes flow through the
-- user-row CASCADE.
CREATE OR REPLACE FUNCTION public.prevent_consents_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'public.consents is append-only (no UPDATE)';
END;
$$;

DROP TRIGGER IF EXISTS consents_no_update ON public.consents;
CREATE TRIGGER consents_no_update
  BEFORE UPDATE ON public.consents
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_consents_mutation();
