-- =============================================================================
-- 0011_moderation.sql
-- Phase 12 — Moderation surface column additions.
--
-- Adds three groups of columns needed by the admin moderation UI and API:
--
--   1. public.users   — banned_at / banned_reason / banned_by
--                       Partial index for fast banned-user list queries.
--                       CHECK: either all three NULL or banned_at IS NOT NULL.
--
--   2. public.tags    — rejected_at / rejected_by / rejected_reason
--                       CHECK: either all three NULL or rejected_at IS NOT NULL
--                       (mirrors tags_approval_consistent from 0002_content.sql).
--
--   3. public.reports — resolution ('dismissed'|'actioned') / notes
--                       Replaces the existing reports_resolution_consistent
--                       CHECK to require resolution IS NOT NULL when resolved.
--
-- Design note: NO is_admin column — admin identity is env-var-based via
-- ADMIN_GITHUB_LOGINS (lib/auth.ts:isAdmin / resolveIsAdmin).
-- RLS policies are unchanged; all moderation writes use service-role.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.users — ban columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS banned_at     timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS banned_reason text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS banned_by     uuid REFERENCES public.users (id) ON DELETE SET NULL;

-- Either every ban field is NULL (not banned) or banned_at IS NOT NULL (banned).
-- banned_reason may be NULL in a banned state — some bans carry no reason.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_ban_consistent;
ALTER TABLE public.users ADD CONSTRAINT users_ban_consistent CHECK (
    (banned_at IS NULL AND banned_by IS NULL AND banned_reason IS NULL)
    OR banned_at IS NOT NULL
);

-- Fast lookup for admin user-list filter (banned users only).
CREATE INDEX IF NOT EXISTS users_banned_idx
    ON public.users (banned_at)
    WHERE banned_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. public.tags — soft-rejection columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS rejected_at     timestamptz;
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS rejected_by     uuid REFERENCES public.users (id) ON DELETE SET NULL;
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS rejected_reason text;

-- Either every rejection field is NULL (not rejected) or rejected_at IS NOT NULL.
-- Mirrors tags_approval_consistent from 0002_content.sql.
-- No constraint preventing both is_approved=true and rejected_at set —
-- admins can re-reject an approved tag; enforcement is app-level.
ALTER TABLE public.tags DROP CONSTRAINT IF EXISTS tags_rejection_consistent;
ALTER TABLE public.tags ADD CONSTRAINT tags_rejection_consistent CHECK (
    (rejected_at IS NULL AND rejected_by IS NULL AND rejected_reason IS NULL)
    OR rejected_at IS NOT NULL
);

-- ---------------------------------------------------------------------------
-- 3. public.reports — resolution columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS resolution text
    CHECK (resolution IN ('dismissed', 'actioned'));
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS notes text;

-- Extend the existing consistency constraint to require resolution IS NOT NULL
-- when resolved_at / resolved_by are set.
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_resolution_consistent;
ALTER TABLE public.reports ADD CONSTRAINT reports_resolution_consistent CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution IS NOT NULL)
);
