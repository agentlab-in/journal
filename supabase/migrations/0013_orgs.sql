-- =============================================================================
-- 0013_orgs.sql
-- Phase 11 — Organizations as publishing entities.
--
-- Introduces:
--   1. public.orgs           — the org record (mirrors public.users style)
--   2. public.org_members    — (org_id, user_id) roster with admin/member roles
--                              + zero-admin trigger to prevent demoting/removing
--                              the last admin.
--   3. public.posts.org_id   — optional FK so a post can be authored to an org.
--   4. public.pinned_posts   — refactored to support EITHER user OR org owners.
--                              Synthetic UUID PK + two COALESCE unique indexes
--                              replace the old (user_id, post_id) PK.
--   5. public.reports        — target_type CHECK extended with 'org'
--   6. public.mod_actions    — target_type CHECK extended with 'org'
--
-- Shared <username>/<org-slug> namespace: users.username UNIQUE and orgs.slug
-- UNIQUE remain the per-table source of truth. Cross-table collisions during
-- signup are gated best-effort via lib/slug-collisions.ts and lib/auth.ts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.orgs
--
-- Mirrors the public.users column conventions:
--   - slug is text with a lowercase CHECK (not citext, so the IRL behaviour
--     matches users.username exactly).
--   - banned_at/banned_reason/banned_by mirror users (see 0011 L33-37).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orgs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                text NOT NULL UNIQUE CHECK (slug = lower(slug)),
    display_name        text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
    bio                 text CHECK (bio IS NULL OR length(bio) <= 500),
    avatar_url          text,
    cover_image_url     text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    created_by_user_id  uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    deleted_at          timestamptz,
    banned_at           timestamptz,
    banned_reason       text,
    banned_by           uuid REFERENCES public.users (id) ON DELETE SET NULL,

    -- Either every ban field is NULL (not banned) or banned_at IS NOT NULL.
    -- Mirrors users_ban_consistent in 0011_moderation.sql:34.
    CONSTRAINT orgs_ban_consistent CHECK (
        (banned_at IS NULL AND banned_by IS NULL AND banned_reason IS NULL)
        OR banned_at IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS orgs_slug_idx ON public.orgs (slug);

-- Fast lookup for admin org-list filter (banned orgs only).
CREATE INDEX IF NOT EXISTS orgs_banned_idx
    ON public.orgs (banned_at)
    WHERE banned_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. public.org_members
--
-- Composite PK (org_id, user_id) — a user belongs to an org at most once.
-- role 'admin' grants moderation/management rights for the org.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_members (
    org_id           uuid NOT NULL REFERENCES public.orgs (id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    role             text NOT NULL CHECK (role IN ('admin', 'member')),
    added_at         timestamptz NOT NULL DEFAULT now(),
    added_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,

    PRIMARY KEY (org_id, user_id)
);

-- Reverse-lookup index for "list orgs I belong to" queries.
CREATE INDEX IF NOT EXISTS org_members_user_idx ON public.org_members (user_id);

-- Zero-admin trigger. Prevents the last admin from being demoted to member or
-- removed entirely. The check is row-level; downgrading or removing a single
-- admin row fires once and either allows the change or raises check_violation.
CREATE OR REPLACE FUNCTION public.org_members_prevent_zero_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    was_admin boolean;
    will_be_admin boolean;
    remaining_admins int;
BEGIN
    was_admin := (OLD.role = 'admin');
    will_be_admin := CASE WHEN TG_OP = 'DELETE' THEN false ELSE (NEW.role = 'admin') END;
    IF was_admin AND NOT will_be_admin THEN
        SELECT count(*) INTO remaining_admins
        FROM public.org_members
        WHERE org_id = OLD.org_id
          AND role = 'admin'
          AND user_id <> OLD.user_id;
        IF remaining_admins < 1 THEN
            RAISE EXCEPTION 'org_members_prevent_zero_admins: would leave org % with no admins', OLD.org_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS org_members_prevent_zero_admins_trigger ON public.org_members;
CREATE TRIGGER org_members_prevent_zero_admins_trigger
    BEFORE UPDATE OR DELETE ON public.org_members
    FOR EACH ROW
    EXECUTE FUNCTION public.org_members_prevent_zero_admins();

-- ---------------------------------------------------------------------------
-- 3. public.posts — add org_id
--
-- ON DELETE RESTRICT: deleting an org with surviving posts must fail loudly
-- so admins surface the issue (soft-delete the org instead, which the posts
-- RLS policy below honours by 404-ing the posts).
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS org_id uuid
    REFERENCES public.orgs (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS posts_org_published_idx
    ON public.posts (org_id, published_at DESC)
    WHERE deleted_at IS NULL AND org_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. public.pinned_posts — XOR owner refactor
--
-- Originally (0002_content.sql:347-355) the table keyed off user_id alone:
--   PRIMARY KEY (user_id, post_id)
--   UNIQUE (user_id, position) AS pinned_posts_position_unique
--
-- Phase 11 lets orgs pin posts too, so a row may be owned by EITHER a user
-- OR an org (XOR). We:
--   - drop the user_id NOT NULL constraint and the two user-only uniques,
--   - introduce a synthetic UUID PK so EITHER owner column can be NULL,
--   - add a XOR CHECK so exactly one of (user_id, org_id) is set,
--   - re-establish the "no duplicate pin" and "one pin per position" rules
--     via COALESCE(user_id, org_id) unique indexes, which transparently
--     handle both owner shapes without partial indexes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pinned_posts DROP CONSTRAINT IF EXISTS pinned_posts_pkey;
ALTER TABLE public.pinned_posts DROP CONSTRAINT IF EXISTS pinned_posts_position_unique;
ALTER TABLE public.pinned_posts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.pinned_posts ADD COLUMN IF NOT EXISTS org_id uuid
    REFERENCES public.orgs (id) ON DELETE CASCADE;
ALTER TABLE public.pinned_posts ADD COLUMN IF NOT EXISTS id uuid
    PRIMARY KEY DEFAULT gen_random_uuid();
ALTER TABLE public.pinned_posts DROP CONSTRAINT IF EXISTS pinned_posts_user_xor_org;
ALTER TABLE public.pinned_posts ADD CONSTRAINT pinned_posts_user_xor_org
    CHECK ((user_id IS NOT NULL) <> (org_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS pinned_posts_owner_post_unique
    ON public.pinned_posts (COALESCE(user_id, org_id), post_id);

CREATE UNIQUE INDEX IF NOT EXISTS pinned_posts_owner_position_unique
    ON public.pinned_posts (COALESCE(user_id, org_id), position);

-- ---------------------------------------------------------------------------
-- 5. public.reports — extend target_type with 'org'
-- ---------------------------------------------------------------------------
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_target_type_check
    CHECK (target_type IN ('post', 'comment', 'user', 'org'));

-- ---------------------------------------------------------------------------
-- 6. public.mod_actions — extend target_type with 'org'
-- ---------------------------------------------------------------------------
ALTER TABLE public.mod_actions DROP CONSTRAINT IF EXISTS mod_actions_target_type_check;
ALTER TABLE public.mod_actions ADD CONSTRAINT mod_actions_target_type_check
    CHECK (target_type IN ('post', 'comment', 'user', 'tag', 'report', 'org'));

-- =============================================================================
-- 7. Row-Level Security
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 7.1 public.orgs
-- ---------------------------------------------------------------------------
ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orgs: service_role full access" ON public.orgs;
CREATE POLICY "orgs: service_role full access"
    ON public.orgs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "orgs: public read non-deleted non-banned" ON public.orgs;
CREATE POLICY "orgs: public read non-deleted non-banned"
    ON public.orgs
    FOR SELECT
    TO anon, authenticated
    USING (deleted_at IS NULL AND banned_at IS NULL);

-- ---------------------------------------------------------------------------
-- 7.2 public.org_members
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members: service_role full access" ON public.org_members;
CREATE POLICY "org_members: service_role full access"
    ON public.org_members
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- A user can read the full roster of any org they belong to.
DROP POLICY IF EXISTS "org_members: member reads own org roster" ON public.org_members;
CREATE POLICY "org_members: member reads own org roster"
    ON public.org_members
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.org_members m
            WHERE m.org_id = org_members.org_id
              AND m.user_id = next_auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- 7.3 public.posts — extend the public-read policy to hide org-owned posts
-- whose org is soft-deleted or banned.
--
-- Drops the original from 0002_content.sql:423-427 and recreates with the
-- extended USING. The "author reads own deleted" policy at L432-436 is
-- intentionally untouched.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "posts: public read non-deleted" ON public.posts;
CREATE POLICY "posts: public read non-deleted"
    ON public.posts
    FOR SELECT
    TO anon, authenticated
    USING (
        deleted_at IS NULL
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
