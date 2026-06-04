-- =============================================================================
-- 0016_sanitize_version.sql
-- Security audit 2026-06-01, finding H12.
--
-- `body_html` on a post is computed once at write-time (see app/api/posts/*)
-- and replayed at read-time. If the MDX sanitize allowlist (`lib/mdx/sanitize.ts`)
-- ever loosens or tightens, existing rows would silently keep replaying under
-- whatever schema was in force when they were authored. To make that drift
-- visible we record the sanitize-allowlist version a row was rendered against.
--
-- The application reads `SANITIZE_VERSION` from `lib/mdx/sanitize.ts` and
-- writes it into this column at create + update time. When the operator
-- bumps that constant, an out-of-band sweep (TODO: `scripts/resanitize.ts`)
-- will re-render stored rows and update this column. Until the sweep runs,
-- `PostBodyStatic` logs a warning for stale rows.
--
-- Picked migration number 0016 to leave room for W3/W4 migrations also
-- queued behind the develop branch.
-- =============================================================================
alter table public.posts
  add column if not exists sanitize_version integer not null default 1;

comment on column public.posts.sanitize_version is
  'MDX sanitize-allowlist version (lib/mdx/sanitize.ts SANITIZE_VERSION) under which body_html was last rendered. Compared on read to detect stale HTML; bumped by writers + the resanitize sweep script.';
