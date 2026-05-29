-- =============================================================================
-- Migration 0003 — Grant base table privileges on public schema
--
-- Phase 2 enabled RLS and added policies on every public.* table but never
-- issued the underlying table-level GRANTs. On a Supabase project where the
-- default schema GRANTs have been reset (or were never standard), this lands
-- as `42501 permission denied for table <x>` from any role — including
-- service_role — even though the row-level policy would have allowed the read.
--
-- Postgres requires BOTH: a table-level GRANT (this migration) AND a passing
-- RLS policy (Phase 2). Without the GRANT, the policy is never even consulted.
--
-- This migration is idempotent and safe to run on any environment.
-- =============================================================================

-- Schema usage is required before any table-level privilege can be exercised.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- service_role: full DML for our admin server client. RLS does not apply to
-- service_role (it BYPASSes), so this is the only thing standing between the
-- server code and the data.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- authenticated + anon: SELECT only; the row-filtering happens via RLS.
-- (Writes by signed-in users go through API routes that use service_role.)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- Default privileges so future tables (Phase 4+) inherit the same shape.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO anon, authenticated;
