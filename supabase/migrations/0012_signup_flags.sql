-- =============================================================================
-- 0012_signup_flags.sql
-- Phase 14 — soft-flag column for suspicious signups.
--
-- Populated by the NextAuth signIn callback via lib/auth/soft-flag.ts.
-- jsonb = {} when evaluated with no flag tripped, jsonb with keys when flags
-- trip, NULL when never evaluated (pre-Phase-14 users).
-- =============================================================================
alter table public.users
  add column if not exists signup_flags jsonb;

comment on column public.users.signup_flags is
  'Soft-flag bag set by Phase 14 signup heuristics. NULL = not evaluated, {} = evaluated clean, populated keys = flags tripped.';
