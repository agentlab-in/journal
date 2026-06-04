-- =============================================================================
-- 0021_github_orgs.sql
-- Phase 11.5 — GitHub-org-backed identity for public.orgs.
--
-- Phase 11.5 replaces the standalone-org auth model from PR #35 with a
-- GitHub-backed sync: an org row is materialized from a GitHub organization
-- the signed-in user belongs to, keyed by GitHub's stable numeric org ID.
-- The login (and therefore the org slug) can change over time — e.g. the
-- `linux` org rebrands to `linuxfoundation` — and the next sync must update
-- the existing row in place rather than insert a duplicate.
--
-- This migration adds the missing key:
--
--   public.orgs.github_org_id  bigint UNIQUE  (nullable)
--
-- For orgs auto-materialized from GitHub, (slug, github_org_id) is canonical
-- and the sync upserts on github_org_id. For any pre-existing orgs
-- (none in prod yet) github_org_id stays NULL — UNIQUE permits multiple NULLs
-- under Postgres semantics, so this is safe.
--
-- org_members.role is intentionally left in place: under the GitHub-backed
-- model every materialized membership is role='member', and the existing
-- CHECK (role IN ('admin','member')) from 0017_orgs.sql:69 is harmless under
-- that constraint. Keeping the column preserves forward-compatibility with
-- any future admin concept without a destructive DROP COLUMN.
-- =============================================================================

-- Track the GitHub org ID so renames don't create duplicate rows.
ALTER TABLE public.orgs ADD COLUMN IF NOT EXISTS github_org_id bigint UNIQUE;

-- For orgs auto-materialized from GitHub, slug + github_org_id is canonical.
-- For any pre-existing orgs (none in prod yet), github_org_id stays NULL.
-- The UNIQUE allows NULL.

-- Don't drop org_members.role — kept for forward-compat. With the
-- GitHub-backed model, every membership is role='member'; the existing
-- CHECK (role IN ('admin','member')) is harmless under that constraint.
