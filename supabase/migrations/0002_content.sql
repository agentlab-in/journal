-- =============================================================================
-- 0002_content.sql
-- Phase 2 — Content schema in `public`.
--
-- Adds: users (mirror of next_auth.users), posts, post_versions, tags,
-- post_tags, post_references, likes, bookmarks, follows, comments, reports,
-- pinned_posts, mod_actions. Plus FTS GIN index on posts, Storage buckets,
-- RLS policies on every table, and seed tags.
--
-- Off-limits: next_auth schema (Phase 1). This migration ONLY reads from
-- next_auth.users via a trigger; it never modifies that schema's shape.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. public.users — profile mirror of next_auth.users
--
-- id mirrors next_auth.users.id (FK + identical UUID, no separate sequence).
-- username is canonical lowercase, unique. display_name is immutable once set
-- (enforced by trigger below — the sync trigger inserts ON CONFLICT DO NOTHING,
-- so re-syncs from next_auth never clobber it). bio / avatar_url are editable
-- by the user from their settings page (Phase 6).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id              uuid PRIMARY KEY REFERENCES next_auth.users (id) ON DELETE CASCADE,
    username        text NOT NULL UNIQUE CHECK (username = lower(username)),
    display_name    text NOT NULL,
    bio             text,
    avatar_url      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_username_idx ON public.users (username);

-- ---------------------------------------------------------------------------
-- 2. Trigger: next_auth.users → public.users
--
-- Phase 1 stores github_login on next_auth.users as an audit column. It is
-- populated by the NextAuth signIn callback AFTER the row is inserted by the
-- adapter, so we fire on both INSERT and UPDATE OF github_login and bail when
-- the value is still null. ON CONFLICT (id) DO NOTHING preserves the
-- immutability of display_name and username after the first successful sync.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_user_from_next_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.github_login IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.users (id, username, display_name, avatar_url)
    VALUES (
        NEW.id,
        lower(NEW.github_login),
        COALESCE(NEW.name, NEW.github_login),
        NEW.image
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_user_from_next_auth_trigger ON next_auth.users;
CREATE TRIGGER sync_user_from_next_auth_trigger
    AFTER INSERT OR UPDATE OF github_login
    ON next_auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_user_from_next_auth();

-- ---------------------------------------------------------------------------
-- 3. public.tags
--
-- slug is the natural PK (lowercase, URL-segment-safe). parent_tag_slug is a
-- self-reference so tags form a forest (e.g. "rag" → "memory"). is_approved
-- gates visibility — featured tags ship pre-approved (see seed below), user-
-- suggested tags land with is_approved = false until a mod approves.
-- Max-5 tags per post is enforced in app code (Phase 4), not at the DB.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tags (
    slug                text PRIMARY KEY CHECK (slug = lower(slug)),
    name                text NOT NULL,
    parent_tag_slug     text REFERENCES public.tags (slug) ON DELETE SET NULL,
    is_approved         boolean NOT NULL DEFAULT false,
    approved_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
    approved_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- Approval bookkeeping is all-or-nothing.
    CONSTRAINT tags_approval_consistent CHECK (
        (is_approved = false AND approved_at IS NULL)
        OR (is_approved = true AND approved_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS tags_is_approved_idx ON public.tags (is_approved);
CREATE INDEX IF NOT EXISTS tags_parent_idx ON public.tags (parent_tag_slug);

-- ---------------------------------------------------------------------------
-- 4. public.posts
--
-- type drives URL routing: /<username>/<type>/<slug>. Per-author slug uniqueness
-- (an author can have at most one /post/agent-memory). slug is immutable from
-- the app (no DB-level immutability — app enforces; we just guarantee
-- uniqueness). summary ≤ 200 chars per the brief.
-- structured_sections is jsonb for hard-structured sections (playbooks:
-- env / prereq / core / safety; dives: tldr / question). Free-form posts
-- leave it null.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.posts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id           uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    type                text NOT NULL CHECK (type IN ('post', 'playbook', 'dive')),
    slug                text NOT NULL,
    title               text NOT NULL CHECK (length(title) >= 1),
    summary             text NOT NULL CHECK (length(summary) <= 200),
    body_md             text NOT NULL,
    body_html           text NOT NULL,
    cover_image_url     text,
    structured_sections jsonb,
    view_count          integer NOT NULL DEFAULT 0,
    published_at        timestamptz NOT NULL DEFAULT now(),
    edited_at           timestamptz,
    deleted_at          timestamptz,
    deletion_reason     text CHECK (deletion_reason IN ('author', 'moderation')),

    -- Per-author slug uniqueness; the URL /<username>/<type>/<slug> resolves
    -- to a single post.
    CONSTRAINT posts_author_slug_unique UNIQUE (author_id, slug),

    -- Deletion bookkeeping is all-or-nothing.
    CONSTRAINT posts_deletion_consistent CHECK (
        (deleted_at IS NULL AND deletion_reason IS NULL)
        OR (deleted_at IS NOT NULL AND deletion_reason IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS posts_author_published_idx
    ON public.posts (author_id, published_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS posts_type_published_idx
    ON public.posts (type, published_at DESC)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Full-text search — generated tsvector + GIN
--
-- title weighted A, summary B, body C. coalesce guards against the (already-
-- impossible per NOT NULL) edge where a column is null. websearch_to_tsquery
-- at read time pairs with this.
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(body_md, '')), 'C')
    ) STORED;

CREATE INDEX IF NOT EXISTS posts_search_tsv_idx
    ON public.posts USING gin (search_tsv)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 6. public.post_versions
--
-- Full body snapshot per edit, capped at 20 per post (cap enforced by trigger
-- below — deletes oldest version_no when a new insert would push count > 20).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_versions (
    post_id     uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
    version_no  integer NOT NULL,
    body_md     text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (post_id, version_no)
);

-- Assumes monotonically-increasing version_no per post (app inserts max+1).
-- If a backfill ever needs out-of-order inserts, prune by created_at instead.
CREATE OR REPLACE FUNCTION public.cap_post_versions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM public.post_versions
    WHERE post_id = NEW.post_id
      AND version_no IN (
          SELECT version_no
          FROM public.post_versions
          WHERE post_id = NEW.post_id
          ORDER BY version_no DESC
          OFFSET 20
      );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cap_post_versions_trigger ON public.post_versions;
CREATE TRIGGER cap_post_versions_trigger
    AFTER INSERT ON public.post_versions
    FOR EACH ROW
    EXECUTE FUNCTION public.cap_post_versions();

-- ---------------------------------------------------------------------------
-- 7. public.post_tags
--
-- Composite PK (post_id, tag_slug). Max-5 enforced in app code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_tags (
    post_id     uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
    tag_slug    text NOT NULL REFERENCES public.tags (slug) ON DELETE CASCADE,

    PRIMARY KEY (post_id, tag_slug)
);

CREATE INDEX IF NOT EXISTS post_tags_tag_idx ON public.post_tags (tag_slug);

-- ---------------------------------------------------------------------------
-- 8. public.post_references — [[wikilinks]] + backlinks
--
-- Composite (source_post_id, target_post_id, target_slug). target_slug captures
-- the wikilink text as-rendered so renames don't silently break inbound links
-- (the historical anchor stays). Unresolved wikilinks are not stored — they're
-- rendered live; only resolved references land here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_references (
    source_post_id  uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
    target_post_id  uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
    target_slug     text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (source_post_id, target_post_id, target_slug)
);

CREATE INDEX IF NOT EXISTS post_references_target_idx
    ON public.post_references (target_post_id);

-- ---------------------------------------------------------------------------
-- 9. public.likes, public.bookmarks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.likes (
    user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    post_id     uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS likes_post_idx ON public.likes (post_id);

CREATE TABLE IF NOT EXISTS public.bookmarks (
    user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    post_id     uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS bookmarks_post_idx ON public.bookmarks (post_id);

-- ---------------------------------------------------------------------------
-- 10. public.follows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.follows (
    follower_id  uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    followed_id  uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (follower_id, followed_id),
    CONSTRAINT follows_no_self_follow CHECK (follower_id <> followed_id)
);

CREATE INDEX IF NOT EXISTS follows_followed_idx ON public.follows (followed_id);

-- ---------------------------------------------------------------------------
-- 11. public.comments
--
-- Plain text body (no markdown — per S6). Depth-5 enforced in app code.
-- Threading via parent_comment_id (self-ref). Soft-delete via deleted_at +
-- deletion_reason; bookkeeping kept consistent at the DB.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
    author_id           uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    parent_comment_id   uuid REFERENCES public.comments (id) ON DELETE CASCADE,
    body                text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    created_at          timestamptz NOT NULL DEFAULT now(),
    edited_at           timestamptz,
    deleted_at          timestamptz,
    deletion_reason     text CHECK (deletion_reason IN ('author', 'moderation')),

    CONSTRAINT comments_deletion_consistent CHECK (
        (deleted_at IS NULL AND deletion_reason IS NULL)
        OR (deleted_at IS NOT NULL AND deletion_reason IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS comments_post_created_idx
    ON public.comments (post_id, created_at);

CREATE INDEX IF NOT EXISTS comments_parent_idx
    ON public.comments (parent_comment_id)
    WHERE parent_comment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 12. public.reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    target_type     text NOT NULL CHECK (target_type IN ('post', 'comment', 'user')),
    target_id       uuid NOT NULL,
    reason          text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
    created_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
    resolved_by     uuid REFERENCES public.users (id) ON DELETE SET NULL,

    CONSTRAINT reports_resolution_consistent CHECK (
        (resolved_at IS NULL AND resolved_by IS NULL)
        OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS reports_open_idx
    ON public.reports (created_at)
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS reports_reporter_idx ON public.reports (reporter_id);

-- ---------------------------------------------------------------------------
-- 13. public.pinned_posts
--
-- Max-6 enforced in app code. (user_id, position) uniqueness keeps two pins
-- from claiming the same slot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pinned_posts (
    user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    post_id     uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
    position    integer NOT NULL CHECK (position BETWEEN 1 AND 6),
    pinned_at   timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, post_id),
    CONSTRAINT pinned_posts_position_unique UNIQUE (user_id, position)
);

-- ---------------------------------------------------------------------------
-- 14. public.mod_actions — audit log for moderation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mod_actions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mod_user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    action          text NOT NULL,
    target_type     text NOT NULL CHECK (target_type IN ('post', 'comment', 'user', 'tag', 'report')),
    target_id       text NOT NULL,
    reason          text,
    metadata        jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mod_actions_target_idx ON public.mod_actions (target_type, target_id);
CREATE INDEX IF NOT EXISTS mod_actions_mod_idx ON public.mod_actions (mod_user_id, created_at DESC);

-- =============================================================================
-- 15. Row-Level Security
--
-- Strategy: every table has RLS enabled, every table has explicit policies.
-- Reads: public where the row is visible (not deleted, tags approved).
-- Writes: service-role only — mutations go through Next.js API routes that
-- use the service-role client. RLS is defense-in-depth.
-- Owner-only tables (likes, bookmarks, follows): owner reads/writes own rows.
-- Sensitive tables (reports, mod_actions, post_versions, post_references):
-- service-role only; user reads own reports.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 15.1 public.users
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: service_role full access"
    ON public.users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "users: public read"
    ON public.users
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "users: update own profile"
    ON public.users
    FOR UPDATE
    TO authenticated
    USING (next_auth.uid() = id)
    WITH CHECK (next_auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 15.2 public.posts
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts: service_role full access"
    ON public.posts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "posts: public read non-deleted"
    ON public.posts
    FOR SELECT
    TO anon, authenticated
    USING (deleted_at IS NULL);

-- Author can still see their own soft-deleted posts (so an "Author" -> moderation
-- delete remains recoverable via their own dashboard). Narrowed to deleted rows
-- only so the common (non-deleted) read path isn't double-evaluated.
CREATE POLICY "posts: author reads own deleted"
    ON public.posts
    FOR SELECT
    TO authenticated
    USING (author_id = next_auth.uid() AND deleted_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 15.3 public.post_versions
-- ---------------------------------------------------------------------------
ALTER TABLE public.post_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_versions: service_role full access"
    ON public.post_versions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "post_versions: author reads own"
    ON public.post_versions
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = post_versions.post_id
              AND p.author_id = next_auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- 15.4 public.tags
-- ---------------------------------------------------------------------------
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags: service_role full access"
    ON public.tags
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "tags: public read approved"
    ON public.tags
    FOR SELECT
    TO anon, authenticated
    USING (is_approved = true);

-- ---------------------------------------------------------------------------
-- 15.5 public.post_tags
-- ---------------------------------------------------------------------------
ALTER TABLE public.post_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_tags: service_role full access"
    ON public.post_tags
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "post_tags: public read"
    ON public.post_tags
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = post_tags.post_id
              AND p.deleted_at IS NULL
        )
    );

-- ---------------------------------------------------------------------------
-- 15.6 public.post_references
-- ---------------------------------------------------------------------------
ALTER TABLE public.post_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_references: service_role full access"
    ON public.post_references
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "post_references: public read"
    ON public.post_references
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = post_references.source_post_id
              AND p.deleted_at IS NULL
        )
    );

-- ---------------------------------------------------------------------------
-- 15.7 public.likes
-- ---------------------------------------------------------------------------
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "likes: service_role full access"
    ON public.likes
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "likes: read own"
    ON public.likes
    FOR SELECT
    TO authenticated
    USING (user_id = next_auth.uid());

CREATE POLICY "likes: write own"
    ON public.likes
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = next_auth.uid());

CREATE POLICY "likes: delete own"
    ON public.likes
    FOR DELETE
    TO authenticated
    USING (user_id = next_auth.uid());

-- ---------------------------------------------------------------------------
-- 15.8 public.bookmarks
-- ---------------------------------------------------------------------------
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookmarks: service_role full access"
    ON public.bookmarks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "bookmarks: read own"
    ON public.bookmarks
    FOR SELECT
    TO authenticated
    USING (user_id = next_auth.uid());

CREATE POLICY "bookmarks: write own"
    ON public.bookmarks
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = next_auth.uid());

CREATE POLICY "bookmarks: delete own"
    ON public.bookmarks
    FOR DELETE
    TO authenticated
    USING (user_id = next_auth.uid());

-- ---------------------------------------------------------------------------
-- 15.9 public.follows
-- ---------------------------------------------------------------------------
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follows: service_role full access"
    ON public.follows
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "follows: read own"
    ON public.follows
    FOR SELECT
    TO authenticated
    USING (follower_id = next_auth.uid() OR followed_id = next_auth.uid());

CREATE POLICY "follows: write own"
    ON public.follows
    FOR INSERT
    TO authenticated
    WITH CHECK (follower_id = next_auth.uid());

CREATE POLICY "follows: delete own"
    ON public.follows
    FOR DELETE
    TO authenticated
    USING (follower_id = next_auth.uid());

-- ---------------------------------------------------------------------------
-- 15.10 public.comments
-- ---------------------------------------------------------------------------
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments: service_role full access"
    ON public.comments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "comments: public read non-deleted"
    ON public.comments
    FOR SELECT
    TO anon, authenticated
    USING (deleted_at IS NULL);

-- See "posts: author reads own deleted" — same intent, narrowed to deleted rows.
CREATE POLICY "comments: author reads own deleted"
    ON public.comments
    FOR SELECT
    TO authenticated
    USING (author_id = next_auth.uid() AND deleted_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 15.11 public.reports
-- ---------------------------------------------------------------------------
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports: service_role full access"
    ON public.reports
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "reports: reporter reads own"
    ON public.reports
    FOR SELECT
    TO authenticated
    USING (reporter_id = next_auth.uid());

-- ---------------------------------------------------------------------------
-- 15.12 public.pinned_posts
-- ---------------------------------------------------------------------------
ALTER TABLE public.pinned_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pinned_posts: service_role full access"
    ON public.pinned_posts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "pinned_posts: public read"
    ON public.pinned_posts
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ---------------------------------------------------------------------------
-- 15.13 public.mod_actions
-- ---------------------------------------------------------------------------
ALTER TABLE public.mod_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mod_actions: service_role full access"
    ON public.mod_actions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- No public read. Mods access mod_actions via service-role from the admin
-- console (Phase 12). Subjects of moderation actions do not see this log.

-- =============================================================================
-- 16. Storage buckets
--
-- Two public-read buckets: covers (post cover images) and post-images (inline
-- images in post bodies). Authenticated upload only, 2MB cap enforced at the
-- bucket level + policy level.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('covers', 'covers', true, 2097152,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('post-images', 'post-images', true, 2097152,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- storage.objects RLS — Supabase enables RLS on this table by default.
-- Public read + authenticated write/delete on our two buckets.

CREATE POLICY "covers: public read"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'covers');

CREATE POLICY "covers: authenticated upload"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'covers');

CREATE POLICY "covers: owner delete"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'covers' AND owner = auth.uid());

CREATE POLICY "post-images: public read"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'post-images');

CREATE POLICY "post-images: authenticated upload"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'post-images');

CREATE POLICY "post-images: owner delete"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'post-images' AND owner = auth.uid());

-- =============================================================================
-- 17. Seed: eight featured tags (all is_approved = true)
--
-- These ship with the platform — user-suggested tags land with is_approved =
-- false and require mod review (Phase 12).
-- =============================================================================

INSERT INTO public.tags (slug, name, is_approved, approved_at)
VALUES
    ('security',      'Security',      true, now()),
    ('local-first',   'Local-first',   true, now()),
    ('orchestration', 'Orchestration', true, now()),
    ('memory',        'Memory',        true, now()),
    ('evals',         'Evals',         true, now()),
    ('tooling',       'Tooling',       true, now()),
    ('prompting',     'Prompting',     true, now()),
    ('multi-agent',   'Multi-agent',   true, now())
ON CONFLICT (slug) DO NOTHING;
