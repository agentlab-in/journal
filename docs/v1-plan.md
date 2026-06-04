# agentlab.in v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan phase-by-phase. Each phase below expands into bite-sized TDD steps at execution time.

**Goal:** Ship the v1 community publishing platform for AI agent infrastructure knowledge (Posts, Playbooks, Deep Dives) — auth, editor, posts, comments, feeds, profiles, search, moderation — in ~2 weeks of focused work.

**Naming note:** The original spec used "Pattern" for the catch-all content type. Per user decision on 2026-05-29, that type is renamed to **"Post"** — a normal post sitting between practical (Playbook) and theoretical (Deep Dive). This drops the URL ↔ type mapping layer entirely: the URL segment, the DB enum value, and the user-facing label are all just `post`. The Problem / Structure / Trade-offs / Related template still ships as an *optional* prefill that authors can use when they happen to be writing a true Fowler-style pattern; it is no longer the type's default body.

**Architecture:** Next.js 16 (App Router) on Vercel, Supabase Postgres + Storage (region `ap-south-1`) as the only backend, NextAuth.js + GitHub OAuth as the only auth, server-side MDX render with a strict component allowlist, Postgres full-text search, in-app notifications, localStorage-only drafts. Mono-typography "Vercel.com-meets-Berkshire-Hathaway" visual identity. Dark + light themes.

**Tech Stack:** Next.js 16 (App Router), TypeScript (strict), Tailwind CSS v4 (CSS-first config — no `tailwind.config.ts`, theme tokens live in `app/globals.css` via `@theme inline`), ESLint 9 flat config (`eslint.config.mjs`), NextAuth.js, Supabase (`@supabase/supabase-js` + `@supabase/ssr`), Postgres (full-text search via `tsvector`), `@uiw/react-codemirror` (editor), `next-mdx-remote` + `rehype-sanitize` (rendering), Prism (syntax highlight, GitHub Dark theme), Mermaid (client-render diagrams), Vercel Analytics, Vercel hosting. Tests: Vitest (unit) + Playwright (e2e). Package manager: **pnpm**.

> **Stack-version note for future subagents:** The original Discussion #2 spec said Next.js 14 / Tailwind v3 / ESLint legacy. As of 2026-05-29 (Phase 0 bootstrap), `create-next-app@latest` produces Next 16 / Tailwind v4 / ESLint 9 flat. User accepted the modernization. **Next 16 has breaking changes vs. training data** — there's an `AGENTS.md` at the repo root spelling this out. Before writing any Next-API code (route handlers, server actions, `next/font`, middleware, etc.), grep `node_modules/next/dist/docs/` for the current API rather than relying on Next 14 memory. If a modernization breaks a feature the plan needs, surface it to the user before rolling back — they want to keep the modern stack "until it doesn't fuck up the app."

**Canonical source of truth:** [Discussion #2](https://github.com/harshitsinghbhandari/agentlab-in/discussions/2). Open decisions resolved on Issue #4 (2026-05-29). Key resolutions baked into this plan:

- Curator handle is **`agentlab-in`** (the user's own GitHub org), not `agentlab` (which collides with an existing org).
- **No staging branch / no staging Supabase project.** Feature → PR → Vercel preview → merge to `main` → production. Single Supabase project (`agentlab-prod`).
- Comments are **plain text only** (no markdown), but support flag/report.
- **No GitHub-repos block on profile pages** (dropped from spec).
- Org-account publishing IS in v1 — verified via GitHub org-admin API, post-as dropdown in editor.

---

## Out of scope (explicit, do not build)

- Email/password auth, password reset, magic links
- Custom usernames, username changes
- Server-side drafts (localStorage only)
- KaTeX/math
- Email digest, web push
- Real personalization for "For You" (heat-rank only)
- Logo (wordmark only)
- Error tracking (Sentry etc.)
- Sponsorships / payments
- External code contributions
- Pre-launch waitlist
- GitHub repos on profile (per user override)
- Staging environment (per user override)

---

## File Structure (target end-state)

```
/
├── app/
│   ├── layout.tsx                          # Root layout: theme provider, nav, footer
│   ├── page.tsx                            # Homepage: 3 cols + mixed heat feed
│   ├── globals.css
│   ├── (marketing)/
│   │   ├── about/page.tsx
│   │   ├── privacy/page.tsx
│   │   ├── terms/page.tsx
│   │   ├── policy/page.tsx                 # Content policy
│   │   └── support/page.tsx
│   ├── sign-in/page.tsx
│   ├── sign-out/page.tsx
│   ├── write/
│   │   ├── page.tsx                        # New post editor
│   │   └── [postId]/page.tsx               # Edit existing post
│   ├── settings/page.tsx                   # Editable profile fields
│   ├── bookmarks/page.tsx                  # Owner-private bookmark list
│   ├── notifications/page.tsx              # In-app inbox
│   ├── tag/[slug]/page.tsx                 # Tag landing
│   ├── tag/[slug]/rss.xml/route.ts
│   ├── admin/
│   │   ├── page.tsx                        # Overview
│   │   ├── tags/page.tsx                   # Approval queue
│   │   ├── reports/page.tsx                # Report queue
│   │   ├── users/page.tsx                  # Block/unblock
│   │   └── posts/page.tsx                  # Mod-delete
│   ├── orgs/claim/page.tsx                 # Org claim flow
│   ├── [username]/
│   │   ├── page.tsx                        # Profile
│   │   ├── rss.xml/route.ts
│   │   └── [type]/[slug]/page.tsx          # Post permalink
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── posts/route.ts                  # POST: publish
│   │   ├── posts/[id]/route.ts             # PATCH, DELETE
│   │   ├── comments/route.ts               # POST
│   │   ├── comments/[id]/route.ts          # PATCH (24h), DELETE
│   │   ├── likes/route.ts                  # POST toggle
│   │   ├── bookmarks/route.ts              # POST toggle
│   │   ├── follows/route.ts                # POST toggle
│   │   ├── tags/route.ts                   # POST suggest, GET list
│   │   ├── reports/route.ts                # POST
│   │   ├── orgs/claim/route.ts             # POST verify+attach
│   │   ├── uploads/route.ts                # POST image
│   │   └── notifications/route.ts          # PATCH mark-read
│   ├── rss.xml/route.ts
│   ├── sitemap.xml/route.ts
│   ├── robots.txt/route.ts
│   ├── not-found.tsx                       # 404
│   └── error.tsx                           # 500
├── components/
│   ├── editor/
│   │   ├── CodeMirrorEditor.tsx
│   │   ├── PreviewPane.tsx
│   │   ├── DraftManager.tsx                # localStorage hooks
│   │   ├── PublishAsSelect.tsx             # me / @org dropdown
│   │   ├── TagPicker.tsx
│   │   ├── CoverImagePicker.tsx
│   │   └── mdx/
│   │       ├── Callout.tsx
│   │       ├── Embed.tsx
│   │       ├── Figure.tsx
│   │       ├── Aside.tsx
│   │       ├── Detail.tsx
│   │       └── MermaidBlock.tsx
│   ├── post/
│   │   ├── PostBody.tsx                    # Renders sanitized body_html
│   │   ├── Backlinks.tsx                   # "Referenced by"
│   │   ├── RelatedPosts.tsx                # Tag-overlap
│   │   ├── CommentThread.tsx
│   │   ├── CommentForm.tsx
│   │   ├── LikeButton.tsx
│   │   ├── BookmarkButton.tsx
│   │   └── ReportButton.tsx
│   ├── profile/
│   │   ├── ProfileHeader.tsx
│   │   ├── PostList.tsx
│   │   ├── PinnedPosts.tsx
│   │   ├── FollowButton.tsx
│   │   └── ProfileStats.tsx
│   ├── feed/
│   │   ├── HeatColumn.tsx                  # generic ranked column
│   │   ├── ForYouColumn.tsx
│   │   ├── PlaybooksColumn.tsx
│   │   ├── DivesColumn.tsx
│   │   └── MixedFeed.tsx
│   ├── notifications/
│   │   ├── NotificationItem.tsx
│   │   └── NotificationBadge.tsx
│   ├── admin/
│   │   ├── TagQueue.tsx
│   │   ├── ReportQueue.tsx
│   │   └── UserSearch.tsx
│   └── layout/
│       ├── Nav.tsx
│       ├── Footer.tsx
│       └── ThemeToggle.tsx
├── lib/
│   ├── auth.ts                             # NextAuth config + signIn gate
│   ├── supabase/
│   │   ├── server.ts                       # Server client (service role)
│   │   ├── browser.ts                      # Browser anon client
│   │   └── admin.ts                        # Service-role for mutations
│   ├── mdx/
│   │   ├── compile.ts                      # MDX → HTML
│   │   ├── sanitize.ts                     # rehype-sanitize schema
│   │   ├── wikilinks.ts                    # [[X]] parser + resolver
│   │   └── components.ts                   # Allowlist registry
│   ├── posts/
│   │   ├── slug.ts                         # title → slug
│   │   ├── render.ts                       # publish pipeline
│   │   └── backlinks.ts                    # post_links upsert
│   ├── feed/
│   │   └── heat-score.ts                   # ranking query
│   ├── search/
│   │   └── full-text.ts                    # tsvector query helper
│   ├── github.ts                           # /user, /orgs APIs
│   ├── reserved-names.ts                   # Reserved-route list
│   ├── notifications.ts                    # Create/read helpers
│   ├── rate-limit.ts                       # Upstash or in-memory
│   ├── drafts.ts                           # localStorage adapter
│   ├── theme.ts                            # Dark/light tokens
│   └── env.ts                              # Zod-validated env
├── middleware.ts                           # Username case, reserved blocks
├── supabase/
│   ├── migrations/
│   │   ├── 0001_init.sql                   # Core tables + indexes
│   │   ├── 0002_rls.sql                    # RLS policies
│   │   ├── 0003_fts.sql                    # tsvector + GIN index
│   │   ├── 0004_storage_policies.sql       # Storage RLS
│   │   └── 0005_seed_tags.sql              # Featured tags
│   └── seed.sql                            # Dev seed
├── tests/
│   ├── unit/
│   │   ├── slug.test.ts
│   │   ├── wikilinks.test.ts
│   │   ├── heat-score.test.ts
│   │   ├── reserved-names.test.ts
│   │   └── mdx/sanitize.test.ts
│   └── e2e/
│       ├── auth.spec.ts
│       ├── publish.spec.ts
│       ├── comments.spec.ts
│       ├── feed.spec.ts
│       ├── search.spec.ts
│       ├── moderation.spec.ts
│       └── org-publish.spec.ts
├── playwright.config.ts
├── vitest.config.ts
├── (no tailwind.config.ts — Tailwind v4 puts theme tokens in app/globals.css via @theme inline)
├── next.config.mjs
├── tsconfig.json
├── .env.example
├── .env.local                              # gitignored
└── package.json
```

---

## Database Schema (referenced by multiple phases)

```sql
-- Lives in supabase/migrations/0001_init.sql, with the RLS / FTS additions in 0002/0003.

create extension if not exists "pgcrypto";

-- Identity
create table users (
  id uuid primary key default gen_random_uuid(),
  github_id bigint unique not null,
  github_login text unique not null,        -- canonical lowercase
  display_name text not null,               -- from GitHub, not editable
  bio text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_blocked boolean not null default false,
  is_deleted boolean not null default false,
  account_type text not null default 'user' check (account_type in ('user', 'org'))
);
create index users_github_login_idx on users (github_login);

-- Org-account aliases (B2): a user can publish as an org they admin
create table account_aliases (
  alias_user_id uuid references users(id) on delete cascade,
  admin_user_id uuid references users(id) on delete cascade,
  verified_at timestamptz not null default now(),
  primary key (alias_user_id, admin_user_id)
);
create index account_aliases_admin_idx on account_aliases (admin_user_id);

-- Posts
create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id),
  type text not null check (type in ('post', 'playbook', 'dive')),
  title text not null,
  slug text not null,
  summary text not null,
  body_md text not null,
  body_html text not null,
  cover_image_url text,
  published_at timestamptz not null default now(),
  edited_at timestamptz,
  view_count int not null default 0,
  like_count int not null default 0,
  bookmark_count int not null default 0,
  comment_count int not null default 0,
  is_deleted boolean not null default false,
  deleted_by text check (deleted_by in (null, 'author', 'admin')),
  unique (author_id, slug)
);
create index posts_author_idx on posts (author_id, published_at desc);
create index posts_type_published_idx on posts (type, published_at desc) where is_deleted = false;

-- URL segment === type value (no mapping needed). 'post' | 'playbook' | 'dive'.

-- Versions (M7)
create table post_versions (
  post_id uuid references posts(id) on delete cascade,
  version_no int not null,
  body_md text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, version_no)
);

-- Tags
create table tags (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  parent_id uuid references tags(id),
  is_approved boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index tags_approved_idx on tags (is_approved);

create table post_tags (
  post_id uuid references posts(id) on delete cascade,
  tag_id uuid references tags(id) on delete cascade,
  primary key (post_id, tag_id)
);
create index post_tags_tag_idx on post_tags (tag_id);

-- Wikilinks (B4)
create table post_links (
  source_post_id uuid references posts(id) on delete cascade,
  target_post_id uuid references posts(id) on delete cascade,
  anchor_text text not null,
  primary key (source_post_id, target_post_id, anchor_text)
);
create index post_links_target_idx on post_links (target_post_id);

-- Engagement
create table likes (
  user_id uuid references users(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table bookmarks (
  user_id uuid references users(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table follows (
  follower_id uuid references users(id) on delete cascade,
  followed_id uuid references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id)
);
create index follows_followed_idx on follows (followed_id);

-- Comments
create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references users(id),
  parent_id uuid references comments(id),
  body text not null,                          -- plain text only, max 5000 chars
  depth int not null default 0,                -- denormalized for query speed (max 5)
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  is_deleted boolean not null default false
);
create index comments_post_idx on comments (post_id, created_at);
create index comments_parent_idx on comments (parent_id);

-- View throttling (M8)
create table view_log (
  post_id uuid references posts(id) on delete cascade,
  viewer_fingerprint text not null,            -- user_id or hashed IP+UA
  viewed_at timestamptz not null default now(),
  primary key (post_id, viewer_fingerprint, viewed_at)
);
create index view_log_recent_idx on view_log (post_id, viewer_fingerprint, viewed_at desc);

-- Pinned posts
create table pinned_posts (
  user_id uuid references users(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  position int not null check (position between 1 and 6),
  primary key (user_id, position)
);

-- Reports
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id),
  target_type text not null check (target_type in ('post', 'comment', 'user')),
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id)
);
create index reports_open_idx on reports (created_at) where resolved_at is null;

-- Notifications
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in (
    'comment', 'reply', 'follow',
    'tag_approved', 'tag_rejected',
    'admin_report', 'admin_tag_pending'
  )),
  payload jsonb not null,                      -- {postId, commenterId, etc.}
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on notifications (user_id, read_at, created_at desc);

-- NextAuth tables (sessions, accounts) — created by @auth/supabase-adapter
```

**Full-text search index (0003_fts.sql):**

```sql
alter table posts add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body_md, '')), 'C')
  ) stored;
create index posts_search_idx on posts using gin (search_tsv) where is_deleted = false;
```

---

## URL ↔ Type

URL segment IS the type value — no mapping. Three types: `post`, `playbook`, `dive`. The TypeScript union and the Postgres check constraint use the same three literals, and the URL `/<username>/<type>/<slug>` uses them directly. A tiny `lib/posts/url.ts` helper builds canonical URLs but does no translation.

---

# Phases

Phases are numbered. Dependencies are explicit. Each phase is a coherent merge — one PR per phase, no half-phases on main.

## Phase 0 — Project Bootstrap

**Goal:** Replace the static landing page with a working Next.js 16 + TypeScript + Tailwind v4 scaffold that deploys to Vercel.

**Depends on:** nothing.

**Status (2026-05-29):** ✅ Shipped on `session/age-1` (commits `526a551..003aff0`). Vercel preview live. See "Stack-version note" in plan header for the Next 14 → 16 + Tailwind v3 → v4 + ESLint legacy → flat acceptances.

**Files:**
- Delete: `index.html` (throwaway landing)
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `postcss.config.mjs`, `eslint.config.mjs` (flat), `.prettierrc`, `.gitignore` updates
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css` (Tailwind v4 `@theme inline` lives here), `app/not-found.tsx`, `app/error.tsx`
- Create: `components/layout/Nav.tsx`, `Footer.tsx`, `ThemeToggle.tsx`
- Create: `lib/env.ts` (Zod-validated env access)
- Create: `vitest.config.ts`, `playwright.config.ts`, `tests/setup.ts`
- Create: `.github/workflows/ci.yml` (typecheck, lint, unit tests, e2e on PR)
- Create: `.env.example`
- Keep: `AGENTS.md`, `CLAUDE.md` (generated by `create-next-app` — Next 16 breaking-change advisory; useful for future subagents)
- Rewrite: `README.md`

**Tasks:**

1. **Scaffold Next.js 16 (App Router) + TS strict.** `pnpm create next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias '@/*' --use-pnpm`. Whatever current is at the time of running. Verify `"strict": true` in `tsconfig.json`.
2. **Mono font + theme tokens.** Add JetBrains Mono via `next/font/google`. Wire in `app/layout.tsx`. Define dark + light color tokens in `app/globals.css` using Tailwind v4's `@theme inline { ... }` block (CSS variables, no `tailwind.config.ts`). Switching done via `data-theme="light|dark"` attribute on `<html>`. Reference palette: pure black `#000`, pure white `#fff`, neutral grays. No accent color beyond off-white/off-black for v1.
3. **Theme toggle (no persistence yet — Phase 13 adds localStorage).** Stub `components/layout/ThemeToggle.tsx`. Place stub in `Nav`.
4. **Wordmark + nav skeleton.** `Nav` with "agentlab" wordmark left, sign-in placeholder right. `Footer` with policy/privacy/terms links (404 until Phase 14).
5. **Vitest setup.** Run `vitest --run` in CI. One throwaway test passes.
6. **Playwright setup.** Run `playwright test` headless against `next dev`. One smoke test: homepage 200s.
7. **GitHub Actions CI.** PR workflow: install → `tsc --noEmit` → `eslint .` → `vitest run` → `playwright test`. Block merge on red.
8. **Vercel project link.** Confirm the repo is already linked (per `gitignore` entry for `.vercel/`). First push to `main` deploys. PR previews work automatically.
9. **Rewrite `README.md`.** Brief: what agentlab.in is, how to dev (`pnpm i && pnpm dev`), env vars to set.

**Acceptance:**
- PR opened → Vercel preview URL renders an empty homepage with wordmark + theme toggle stub.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` all green locally.
- Merging to `main` produces a production deploy at `agentlab.in` serving the same empty homepage.
- CI workflow blocks a PR that breaks types.

---

## Phase 1 — Auth, Identity, Sign-up Gate

**Goal:** GitHub OAuth sign-in working end-to-end, with the 30-day-account + ≥1-public-repo gate enforced and reserved usernames blocked.

**Status (2026-05-29):** ✅ Shipped on `feat/phase-1-auth` (commit SHA TBD).

**Deviations from original spec:**
- Original spec said `next-auth + @auth/supabase-adapter`. Those packages are version-incompatible (`@auth/supabase-adapter` is for `@auth/core` / NextAuth v5, not the legacy `next-auth` v4 package). Shipped `next-auth@4.24.14` + `@next-auth/supabase-adapter@0.2.1` instead (both stable, both explicitly support Next 16 in peerDependencies). Authjs v5 was still in beta with no GA release.
- Auth routes placed at `app/auth/signin` and `app/auth/blocked` (not `app/sign-in` and `app/sign-in/rejected` as in the file list below) — matches the brief's scope section URL conventions more cleanly and avoids a nested route collision.
- Profile auto-creation beyond NextAuth adapter tables deferred to Phase 2 as specified in the brief's "Out of scope" section.
- `middleware.ts` (canonical-case redirect) deferred to Phase 6 as specified in the brief's "Out of scope" section.

**Depends on:** Phase 0.

**Files:**
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `lib/auth.ts` (NextAuth config + signIn callback)
- Create: `lib/github.ts` (GitHub REST helpers)
- Create: `lib/reserved-names.ts` (list + helpers)
- Create: `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `lib/supabase/browser.ts`
- Create: `supabase/migrations/0001_init.sql` (users table + NextAuth tables via `@auth/supabase-adapter`)
- Create: `app/sign-in/page.tsx`, `app/sign-out/page.tsx`
- Create: `app/sign-in/rejected/page.tsx` (gate failure)
- Create: `middleware.ts` (canonical-case username redirect — full reserved-route logic comes in Phase 6 when `[username]` route exists)
- Create: `tests/unit/reserved-names.test.ts`
- Create: `tests/e2e/auth.spec.ts`
- Modify: `components/layout/Nav.tsx` (real sign-in button)

**Tasks:**

1. **Provision Supabase project.** Region `ap-south-1`, name `agentlab-prod`. Pull connection string + service-role key. Add to Vercel env (Production + Preview). Add `.env.example`. (No staging project per S5 override.)
2. **Write `0001_init.sql`.** Just the `users` table + NextAuth's required tables (use the official `@auth/supabase-adapter` migration SQL — copy verbatim). Push via `supabase db push`.
3. **NextAuth config in `lib/auth.ts`.** Provider: GitHub only. Adapter: `@auth/supabase-adapter`. Session strategy: `database` (M2).
4. **`signIn` callback enforcing the gate.** Fetch `GET /user` from GitHub with the new access token. Compute account age and check `public_repos >= 1`. If either fails, return a redirect URL string like `/sign-in/rejected?reason=age_27_days` or `?reason=no_public_repos`. Re-check every sign-in, not just first (so user who was 29 days old comes back at 30).
5. **`signIn` callback enforcing reserved-name block.** If the GitHub `login` (lowercased) is in `lib/reserved-names.ts`, redirect to `/sign-in/rejected?reason=reserved_name` with a "contact support" line. Vanishingly rare.
6. **`lib/reserved-names.ts`.** Export the full list from the questions-file S1 default plus `agentlab-in` (the curator handle itself is reserved from *new* signups — only Harshit owns it). Export `isReserved(name: string): boolean`.
7. **`/sign-in/rejected/page.tsx`.** Reason-aware: shows the exact failing condition and (for age) the date when they'll be eligible.
8. **Canonical lowercase usernames.** Persist `github_login` lowercased. `middleware.ts` 301s any mixed-case `/<Username>` path to lowercase. (Reserved-route blocking added in Phase 6.)
9. **Profile auto-creation on first sign-in.** NextAuth `signIn` event populates `users.github_login`, `users.display_name`, `users.bio`, `users.avatar_url` from the GitHub `/user` payload. `account_type = 'user'`.
10. **Sign-out flow.** `/sign-out` triggers `signOut()` and redirects to `/`.
11. **Admin allowlist env var.** `ADMIN_GITHUB_LOGINS=harshitsinghbhandari` (comma-separated). `isAdmin(login)` helper in `lib/auth.ts`. Used in Phase 12, but install the env scaffold now.
12. **Tests.**
    - Unit: `isReserved` returns true for "tag", "API" (case-insensitive), "agentlab-in"; false for "harshitsinghbhandari".
    - E2E: sign-in button visible when signed out; signing in with the test account (Harshit's real account is fine for dev) redirects to homepage with avatar in nav.

**Acceptance:**
- Harshit signs in successfully; row appears in `users` with canonical login.
- A test fixture simulating a 27-day-old account is rejected with the dated message ("eligible on YYYY-MM-DD").
- A test fixture with zero public repos is rejected with that specific reason.
- Mixed-case URL `/HARSHITSinghBhandari` 301s to lowercase.
- Sign-out clears the session; nav reverts to "Sign in with GitHub."

---

## Phase 2 — Database Schema, RLS, Search Index

**Goal:** Complete v1 schema migrated, RLS policies in place, FTS index live, storage buckets provisioned.

**Depends on:** Phase 1 (users + NextAuth tables already exist).

**Files:**
- Create: `supabase/migrations/0002_content.sql` (posts, tags, post_tags, post_versions, post_links, likes, bookmarks, follows, comments, view_log, pinned_posts, reports, notifications, account_aliases)
- Create: `supabase/migrations/0003_rls.sql` (policies for read-public/write-via-API tables)
- Create: `supabase/migrations/0004_fts.sql` (tsvector + GIN)
- Create: `supabase/migrations/0005_storage.sql` (Storage buckets + policies)
- Create: `supabase/migrations/0006_seed_tags.sql` (eight featured tags, all approved)
- Create: `supabase/seed.sql` (dev fixtures — one user, one post per type)

**Tasks:**

1. **Write `0002_content.sql`.** Use the schema in the Database Schema section above verbatim. Include all indexes.
2. **Write `0003_rls.sql`.** RLS strategy (M1):
   - Enable RLS on: `users`, `posts`, `tags`, `post_tags`, `post_links`, `comments`, `pinned_posts`, `notifications`. Public read where `is_deleted = false` AND (for tags) `is_approved = true` OR caller is admin.
   - Enable RLS on: `likes`, `bookmarks`, `follows`. Owner-only read/write (auth.uid() match), public count via SQL function.
   - Enable RLS on `notifications`: owner-only read.
   - `reports`, `view_log`, `post_versions`, `account_aliases`, `account` (NextAuth), `session` (NextAuth): **no public access**; service-role only.
   - All mutations go through Next.js API routes using the service-role client — RLS is defense-in-depth, not the primary write authorization.
3. **Write `0004_fts.sql`.** tsvector generated column + GIN index on `posts` (see schema section).
4. **Write `0005_storage.sql`.** Create two Storage buckets: `covers` (public read), `avatars` (public read — though we use GitHub avatars, kept for future). Policies: write requires authenticated user; size cap 2MB enforced in policy.
5. **Write `0006_seed_tags.sql`.** Insert the eight featured tags with `is_approved = true`, `created_by = null`: `security`, `local-first`, `orchestration`, `memory`, `evals`, `tooling`, `prompting`, `multi-agent`.
6. **Write `supabase/seed.sql`.** Dev-only: one fake user (`__dev`), one post of each type, one comment, one like. Run separately from migrations.
7. **Push migrations + verify.** `supabase db push`. `psql` + `\d posts` to confirm schema matches.
8. **Generate TS types.** `supabase gen types typescript --linked > lib/supabase/types.ts`. Commit.

**Acceptance:**
- `supabase db push` runs cleanly on a fresh DB.
- All 8 featured tags exist with `is_approved = true`.
- A full-text query (`select id from posts where search_tsv @@ websearch_to_tsquery('english','agent')`) returns indexed seed-post hits.
- Attempting a direct `INSERT INTO posts` via the anon key fails (RLS rejects).
- `lib/supabase/types.ts` compiles with no errors.

---

## Phase 3 — Editor & Drafts

**Goal:** A working /write route with the split-pane editor, MDX compile pipeline, localStorage drafts, and all required-field validation. Publishing wired up later (Phase 4); this phase ends at a draft you can preview but not yet publish.

**Depends on:** Phases 1, 2.

**Files:**
- Create: `app/write/page.tsx`, `app/write/[postId]/page.tsx`
- Create: `components/editor/CodeMirrorEditor.tsx`, `PreviewPane.tsx`, `DraftManager.tsx`, `PublishAsSelect.tsx` (single-option for now — fully wired in Phase 11), `TagPicker.tsx`, `CoverImagePicker.tsx`
- Create: `components/editor/mdx/{Callout,Embed,Figure,Aside,Detail,MermaidBlock}.tsx`
- Create: `lib/mdx/compile.ts`, `sanitize.ts`, `wikilinks.ts`, `components.ts`
- Create: `lib/posts/slug.ts`
- Create: `lib/drafts.ts`
- Create: `app/api/uploads/route.ts` (image upload to Storage)
- Create: `tests/unit/{slug,wikilinks,mdx/sanitize}.test.ts`

**Tasks:**

1. **Editor shell at `/write`.** Three-section layout: top bar (type picker, title input, summary input, tag picker, cover image, "publish-as" select stub, publish button — disabled until validation passes), split pane (CodeMirror left, preview right), bottom status ("draft saved 5s ago").
2. **Type picker.** Three buttons: **Post** / **Playbook** / **Deep Dive**. Selecting a type pre-fills the body with template headings:
   - Post: empty body by default. An "Insert Pattern template" button in the editor toolbar inserts `## Problem\n\n## Structure\n\n## Trade-offs\n\n## Related\n` for authors who want the Fowler-style structure. Optional — not enforced.
   - Playbook: `## Environment / Target\n\n## Prerequisites\n\n## Core Instructions\n\n## Safety / Failure Modes\n` — all four headings required, enforced at publish (Phase 4).
   - Deep Dive: `## TL;DR\n\n## The Question\n` — both required, enforced at publish.
3. **CodeMirror integration.** `@uiw/react-codemirror` with markdown language pack, line wrap on, dark/light theme matches site theme.
4. **MDX compile pipeline (`lib/mdx/compile.ts`).** Use `next-mdx-remote/serialize`. Plugins:
   - `remark-gfm` (tables, task lists)
   - `remark-wikilinks` (custom — see step 8)
   - `rehype-prism-plus` (with GitHub Dark theme CSS)
   - `rehype-sanitize` (with the schema from step 7)
   - Mermaid handled client-side: a `MermaidBlock` component renders ```mermaid fenced blocks via the `mermaid` package on the client.
5. **MDX allowlist (`lib/mdx/components.ts`).** Export only: `Callout`, `Embed`, `Figure`, `Aside`, `Detail`. No others.
6. **Build each MDX component** as a thin Tailwind-styled wrapper. `Embed` server-side fetches oEmbed for tweets/YouTube/GitHub gists; if unsupported, falls back to a styled blockquote link.
7. **`rehype-sanitize` schema.** Start from `defaultSchema`, add: the five MDX allowlist tags and their declared attributes, `<pre>`/`<code>` for code blocks, `<sub>`/`<sup>`. Strip everything else including raw `<script>`, `<iframe>` (except inside allowlisted `Embed`), inline event handlers, `style` attributes.
8. **Wikilink parser (`lib/mdx/wikilinks.ts`).** A `remark` plugin that finds `[[X]]` in text nodes and replaces with a link node pointing to `/wikilink-resolve?title=X` (resolution stub — Phase 4 finalizes). Optional `[[X|alias]]` syntax: `X` is the lookup, `alias` is the display text.
9. **Live preview pane (`PreviewPane.tsx`).** Debounced 300ms, runs MDX compile in a Web Worker (off main thread) to keep typing smooth. Renders the result with the same MDX components used at read-time.
10. **Tag picker (`TagPicker.tsx`).** Searchable autocomplete over `tags` where `is_approved = true`. Allows up to 5. Typing a non-existent tag → "Suggest new tag: '<x>'" option; on selection, the tag is created at publish-time (Phase 4) with `is_approved = false`.
11. **Cover image picker (`CoverImagePicker.tsx`).** Tabs: "URL" (paste a URL, validated as `https://…`, content-type sniffed via HEAD) or "Upload" (drag-drop, 2MB limit, calls `/api/uploads`). Stored URL goes into form state only.
12. **`/api/uploads/route.ts`.** Auth-required. Reads multipart, validates: 2MB cap, MIME ∈ {jpeg, png, webp, gif}, sniff bytes (not header), max dimensions 6000×6000. Resize to ≤1600px wide, strip EXIF, convert to WebP. Upload to `covers/` bucket. Return public URL.
13. **Slug generation (`lib/posts/slug.ts`).** Lowercase, ASCII-fold (`unidecode`), kebab-case, strip a basic English stopword list, truncate to 80 chars. Pure function with tests.
14. **Draft manager (`lib/drafts.ts`).** localStorage key: `agentlab.draft.new` (composing) or `agentlab.draft.edit.<postId>` (editing). Value: `{ title, body, type, tags, summary, cover_image_url, savedAt: ISO, schemaVersion: 1 }`. Methods: `loadDraft(key)`, `saveDraft(key, payload)`, `clearDraft(key)`, `hasNewerServerVersion(draft, post)`.
15. **Draft restore prompt.** On `/write` open: if a `new` draft exists, show modal "Restore your last draft?" with Restore / Discard. On `/write/[postId]` open: if an `edit` draft exists AND server `updated_at > draft.savedAt`, show "This post was edited elsewhere — keep your local draft or discard?"
16. **30s auto-save.** Debounced 30s after last keystroke. Status bar shows "saved X ago." No server call.
17. **Required-field validation.** Publish button enabled iff: title ≥ 5 chars, summary ≥ 10 chars and ≤ 200 chars, body ≥ 50 chars, type set, ≥1 tag selected. For Playbook: all four section headings present in body. For Deep Dive: `## TL;DR` and `## The Question` present.
18. **Tests.**
    - Unit: `slug('Hello, World!') === 'hello-world'`; `slug('Café Olé')` ASCII-folds; long titles truncate. Wikilink parser handles `[[X]]`, `[[X|alias]]`, escapes inside code blocks. Sanitizer strips `<script>` and inline `onclick=`.
    - E2E: type a title, select Post, type body; reload page; restore modal appears; restore preserves all fields.

**Acceptance:**
- A signed-in user can open `/write`, pick a type, write, and see live preview update.
- Drafts survive a page reload via the restore prompt.
- Publish button stays disabled until all required fields pass; tooltip explains what's missing.
- Image upload accepts a 1.5MB PNG and rejects a 3MB JPEG with a clear error.
- Mermaid block renders a diagram in the preview.
- `<script>alert(1)</script>` typed into the body is stripped from the preview.

---

## Phase 4 — Posts, Tags, Publishing API

**Goal:** Server-side publishing wired up — posts persist, tags auto-create as pending, wikilinks resolve and backlinks update.

**Depends on:** Phases 2, 3.

**Files:**
- Create: `app/api/posts/route.ts`, `app/api/posts/[id]/route.ts`
- Create: `app/api/tags/route.ts`
- Create: `lib/posts/render.ts` (publish pipeline)
- Create: `lib/posts/backlinks.ts`
- Create: `lib/posts/url.ts` (URL ↔ type mapping single source)
- Modify: `lib/mdx/wikilinks.ts` (resolver phase)
- Modify: `components/editor/*.tsx` (wire publish button to API)
- Create: `tests/e2e/publish.spec.ts`

**Tasks:**

1. **`lib/posts/url.ts`.** Tiny helper, no mapping needed since URL segment === type:
   ```ts
   export type PostType = 'post' | 'playbook' | 'dive';
   export const POST_TYPES: readonly PostType[] = ['post', 'playbook', 'dive'] as const;
   export function postUrl(author: string, type: PostType, slug: string): string {
     return `/${author}/${type}/${slug}`;
   }
   export function isPostType(s: string): s is PostType {
     return (POST_TYPES as readonly string[]).includes(s);
   }
   ```
2. **`POST /api/posts`.** Auth required. Body: `{ title, summary, body_md, type, tag_slugs[], cover_image_url? }`. Steps:
   - Server-side re-validate every required field (do NOT trust client).
   - Generate slug; if collision with same author, append `-2`, `-3`, ...
   - Compile MDX → HTML via `lib/posts/render.ts` (re-uses `lib/mdx/compile`).
   - For each tag slug not in DB: insert with `is_approved = false`. Reserved-name overlap check on each new slug. (Admin notification deferred to Phase 12.)
   - Resolve wikilinks (see step 5) and write `post_references` rows.
   - Insert into `posts`, `post_tags`, `post_versions(version_no=1)`.
   - Return `{ id, slug, url }`.
3. **`PATCH /api/posts/[id]`.** Auth required; author OR admin (admin path used by Phase 12 mod surfaces). Body: same shape minus `type` (immutable, enforced by Zod). Steps:
   - **Snapshot the PRIOR `body_md` into `post_versions` BEFORE updating** (version_no = MAX+1). The `cap_post_versions` trigger keeps the last 20.
   - Re-compile HTML, re-resolve wikilinks (delete-then-insert this post's `post_references` rows).
   - Update `posts.body_md`, `body_html`, `title` (slug stays), `summary`, `structured_sections`, `cover_image_url`, `edited_at = now()`.
   - Replace `post_tags` (delete-then-insert). New tags create pending rows like step 2.
4. **`DELETE /api/posts/[id]`.** Auth required; author OR admin. Soft-delete: set `deleted_at = now()`, `deletion_reason = 'author'` (author path) or `'moderation'` (admin path). Do NOT delete `post_references`, `comments`, `likes`, `bookmarks`, `post_tags` — backlinks display logic excludes deleted posts at read time.
5. **Wikilink resolver (B4 semantics, slug-based per E1).**
   - Parse all `[[X]]` and `[[X|alias]]` from `body_md` (skip fenced + inline code).
   - For each anchor `X`, slugify and look up `posts WHERE slug = slug(X) AND deleted_at IS NULL`.
     - Tie-break order: (a) author = current user, (b) `COUNT(public.likes) DESC` (no denormalised `like_count` until Phase 8), (c) most recent `published_at`.
   - If match found: store `(source_post_id, target_post_id, target_slug = slug(X))` in `post_references`; rewrite link href to canonical post URL.
   - If no match: render as `<span class="broken-wikilink" title="Unresolved wikilink">X</span>`.
6. **`POST /api/tags`.** Auth required. Body: `{ name }`. Generates kebab-case slug. Inserts row with `is_approved = false`. Used by the editor's TagPicker when a user types a new tag, BUT actual creation happens at publish-time in step 2 — this endpoint exists for the tag picker's "create on the fly" UX so the new tag appears in autocomplete results immediately while still in the editor.
7. **Wire publish button.** Editor's publish button calls `POST /api/posts` → on success, `router.push(returnedUrl)`. Clears the localStorage draft. Edit page calls `PATCH /api/posts/[id]`.
8. **Tests.**
    - E2E: full publish flow — sign in, write a post with one existing tag and one new tag, publish, land on post URL, confirm new tag exists as pending in DB.
    - E2E: write post A with `[[B's Title]]`, publish; write post B with title "B's Title"; re-publish A (or write a fresh A that links to B post-creation); confirm `post_references` row exists and A's rendered HTML contains a link to B's URL.

**Acceptance:**
- Publishing a valid post lands the user on `/<username>/<type>/<slug>` (route may 404 until Phase 5 — but URL is correct).
- Slug collisions auto-suffix.
- Submitting a new tag creates a pending row (admin notification deferred to Phase 12).
- Wikilinks resolve at save time; backlink rows present in `post_references`.
- Soft-deletion sets `deleted_at` + `deletion_reason` and the row is preserved.

---

## Phase 5 — Post Page (Read)

**Goal:** Public post permalink renders fully — body, tags, cover, counts, related, backlinks. View counter increments with throttle.

**Depends on:** Phases 2, 4. Visual polish in Phase 13.

**Files:**
- Create: `app/[username]/[type]/[slug]/page.tsx`
- Create: `components/post/PostBody.tsx`, `Backlinks.tsx`, `RelatedPosts.tsx`
- Modify: `middleware.ts` (add reserved-route enforcement)
- Create: `app/api/posts/[id]/view/route.ts` (view increment)
- Create: `tests/e2e/post-page.spec.ts`

**Tasks:**

1. **Route file `app/[username]/[type]/[slug]/page.tsx`.** Server component. Resolves `username` → user, `type` URL segment → stored type, fetches post by `(author_id, slug, type)`. 404 if not found. 410 with deletion notice if `is_deleted`.
2. **Render PostBody.** Server-render the stored `body_html`. Mermaid blocks are placeholders that the `MermaidBlock` client component hydrates on mount.
3. **Cover image, title, summary, author byline.** Author byline links to `/<username>` (profile, Phase 6).
4. **Tag chips.** Each links to `/tag/<slug>`. Tags with `is_approved = false` show as muted (visible on post page but not on tag landing).
5. **Counts row.** Likes, bookmarks, comments. View count visible ONLY to author (M8): check `session.user.id === post.author_id` server-side.
6. **`RelatedPosts.tsx`.** Query: other posts sharing ≥1 tag with this one, ordered by tag-overlap-count then heat-score, limit 5, exclude `is_deleted`, exclude self.
7. **`Backlinks.tsx` ("Referenced by").** Query `post_links WHERE target_post_id = this.id` joined with `posts` filtered to non-deleted. Show as a list of post links at the bottom.
8. **View counter `/api/posts/[id]/view`.** POST. Fingerprint = `session.user.id ?? sha256(IP + UA)`. Insert into `view_log`; if no row in last 24h for this (post, fingerprint), increment `posts.view_count`. Otherwise no-op. Called via `<Image>`-tag-style 1x1 beacon or `fetch` on page mount.
9. **Reserved-route middleware enforcement.** `middleware.ts` checks if path's first segment matches `lib/reserved-names.ts` and the path is NOT in the actual platform routes (which Next.js routes statically anyway). The reserved list mainly prevents a future user with a colliding GitHub login from claiming the URL — Phase 1 already blocks sign-up, but middleware adds a guard.
10. **Tests.**
    - E2E: open a published seed post; counts row visible; tag links navigate to tag page (which 404s in Phase 5; Phase 9 implements).
    - E2E: refresh post page 3 times in 10 seconds — `view_count` increments once.
    - E2E: open a soft-deleted post → 410 Gone with deletion message.

**Acceptance:**
- Published seed post renders correctly at the canonical URL.
- Author sees the view-count badge; non-author does not.
- Backlinks section appears on a post that is linked-to by another.
- Related posts surface for any post with shared tags.
- Mermaid diagram in seed deep-dive renders client-side.

---

## Phase 6 — Profile Pages, Follow, Pinned Posts, Settings

**Goal:** `/<username>` works. Editable profile settings. Follow/unfollow. Pinned posts (max 6). No GitHub-repos block (per user override M11).

**Depends on:** Phases 1, 5.

**Files:**
- Create: `app/[username]/page.tsx`
- Create: `app/settings/page.tsx`
- Create: `components/profile/{ProfileHeader,PostList,PinnedPosts,FollowButton,ProfileStats}.tsx`
- Create: `app/api/follows/route.ts` (POST toggle)
- Create: `app/api/users/me/route.ts` (PATCH for settings)
- Create: `app/api/users/me/pinned/route.ts` (POST/DELETE pin)
- Modify: `middleware.ts` (handle `/<username>` not-found gracefully — fall through to Next.js route)

**Tasks:**

1. **`/<username>` route.** Server component. Lookup user by canonical lowercase login; 404 if none (user might not exist on agentlab yet — DO NOT show GitHub-fetched data for non-members; their first sign-in creates the row).
2. **`ProfileHeader.tsx`.** Avatar (GitHub avatar URL), display name, bio, follower/following counts, follow button (if not me).
3. **`ProfileStats.tsx`.** Public stats: post count, follower count. Author-only stat: total view count (sum across non-deleted posts).
4. **`PostList.tsx`.** Tabs: All / Posts / Playbooks / Deep Dives. Lists posts by this author (`is_deleted = false`), newest first, paginated 20 per page.
5. **`PinnedPosts.tsx`.** Above the post list. Shows the user's `pinned_posts` (max 6, ordered by `position`). If the profile owner is viewing, each post has a pin/unpin control. Settings page (step 7) has the full pin manager.
6. **`FollowButton.tsx`.** Optimistic toggle via `POST /api/follows`. Body `{ followed_id }`. Auth required.
7. **`/settings` page.** Editable fields: `bio` (spec says everything except display_name and username). Avatar refresh = button that re-fetches from GitHub. Pinned posts manager: select up to 6 of your published posts, reorder. PATCH `/api/users/me`.
8. **`PATCH /api/users/me`.** Updates `bio`. Other fields rejected.
9. **`POST /api/users/me/pinned`.** Body `{ post_id, position }`. Validates ownership, position 1-6.
10. **`DELETE /api/users/me/pinned`.** Body `{ post_id }`.
11. **Reserved-route guard at `/<username>`.** If the first path segment is in the reserved list AND no matching app route exists, return 404. (Most reserved names ARE app routes, so this is belt-and-braces.)
12. **Tests.**
    - E2E: sign in, navigate to `/<my-username>`, see avatar + bio.
    - E2E: pin a post → it shows at the top of the profile.
    - E2E: follow another user → button toggles to "Following"; their `follower_count` increments.
    - E2E: visit a non-existent `/<not-a-real-user>` → 404, not a GitHub-data-fetch attempt.

**Acceptance:**
- Profile page renders with the right data for existing users.
- Settings page lets you edit bio and pin posts; rejects edits to display_name/username.
- Follow round-trips and persists.
- No GitHub repos block on the profile (intentional).

---

## Phase 7 — Comments

**Goal:** Threaded plain-text comments with max depth 5, 24-hour author edit window, soft-delete, and per-comment report button.

**Depends on:** Phases 2, 5.

**Files:**
- Create: `components/post/CommentThread.tsx`, `CommentForm.tsx`, `ReportButton.tsx`
- Create: `app/api/comments/route.ts`, `app/api/comments/[id]/route.ts`
- Modify: `app/[username]/[type]/[slug]/page.tsx` (embed `CommentThread`)
- Create: `tests/e2e/comments.spec.ts`

**Tasks:**

1. **`POST /api/comments`.** Auth required. Body `{ post_id, parent_id?, body }`. Validation: body ≤ 5000 chars, plain text (server-side strip any HTML — even though we render it as text, defense in depth). Compute `depth = parent.depth + 1` (or 0 if root); reject if `depth > 5`. Insert row. Increment `posts.comment_count`. Emit notification: if root, `comment` to post author; if reply, `reply` to parent comment author (unless replying to self).
2. **`PATCH /api/comments/[id]`.** Auth, author-only. Reject if `now() - created_at > 24h`. Update `body`, set `edited_at`.
3. **`DELETE /api/comments/[id]`.** Auth, author OR admin. Soft-delete: set `is_deleted = true`, blank the `body` (replaced display = "[deleted]"). Do NOT delete replies; they remain.
4. **`CommentThread.tsx`.** Recursive component, max nesting visually = 5; deeper would have been rejected at insert. Each comment shows author byline, timestamp, edit indicator if `edited_at`, reply button, edit button (if mine + <24h), delete button (if mine), report button (if not mine).
5. **`CommentForm.tsx`.** Textarea (plain), character counter, submit. Used both at the top (new root comment) and inline (reply).
6. **`ReportButton.tsx` (generic).** Modal with reason text input; POSTs to `/api/reports` (Phase 12). Used on comments AND posts. Per S6 override: comments DO have report.
7. **Tests.**
    - E2E: post a comment → appears in thread; comment_count increments.
    - E2E: reply to a 5-deep comment → server returns 400 with depth message.
    - E2E: edit a comment within 24h → succeeds; edited indicator visible. Edit after 24h (use SQL to backdate) → 403.
    - E2E: delete own comment → body shows "[deleted]," replies still visible.
    - E2E: comments body field stripped of `<script>` → renders as literal text.

**Acceptance:**
- Threaded comments work end-to-end, including replies.
- 5-deep depth limit enforced server-side.
- 24h edit window enforced.
- Soft-deletion preserves thread structure.
- Plain-text comments; no markdown rendering, no embeds, no images.
- Per-comment report flow opens the modal and creates a report row.

---

## Phase 8 — Likes & Bookmarks

**Goal:** Like (single-heart) and bookmark (private, flagship) toggles working with optimistic UI.

**Depends on:** Phases 2, 5.

**Files:**
- Create: `app/api/likes/route.ts`, `app/api/bookmarks/route.ts`
- Create: `components/post/LikeButton.tsx`, `BookmarkButton.tsx`
- Create: `app/bookmarks/page.tsx`
- Modify: `app/[username]/[type]/[slug]/page.tsx` (embed buttons)
- Create: `tests/e2e/engagement.spec.ts`

**Tasks:**

1. **`POST /api/likes`.** Auth required. Body `{ post_id }`. Toggle: if row exists, delete + decrement `like_count`; if not, insert + increment. Return new count + isLiked.
2. **`LikeButton.tsx`.** Optimistic toggle. Heart icon, fills on like. Count visible. Disabled when signed out (or click → sign-in modal).
3. **`POST /api/bookmarks`.** Same shape as likes. Updates `bookmark_count`.
4. **`BookmarkButton.tsx`.** Same UX as LikeButton. Bookmark icon.
5. **`/bookmarks` page.** Auth required. Lists bookmarks for current user, newest first, paginated 20. Strictly private (no public bookmark list per S7).
6. **Tests.**
    - E2E: like a post twice → count increments then decrements; row toggles in DB.
    - E2E: bookmark a post; navigate to `/bookmarks` → see it. Sign in as a different user, navigate to `/bookmarks` → don't see the other user's bookmarks.

**Acceptance:**
- Likes and bookmarks round-trip and persist.
- Counts visible publicly.
- Bookmark list is owner-only.

---

## Phase 9 — Feed, Tag Landing, Search, RSS, Sitemap

**Goal:** Homepage renders the 3-column + mixed-heat layout. Tag landing pages live. Full-text search works. RSS + sitemap available.

**Depends on:** Phases 2, 5, 8.

**Files:**
- Modify: `app/page.tsx` (real homepage)
- Create: `app/tag/[slug]/page.tsx`
- Create: `app/search/page.tsx`
- Create: `components/feed/{HeatColumn,ForYouColumn,PlaybooksColumn,DivesColumn,MixedFeed}.tsx`
- Create: `lib/feed/heat-score.ts`
- Create: `lib/search/full-text.ts`
- Create: `app/rss.xml/route.ts`, `app/[username]/rss.xml/route.ts`, `app/tag/[slug]/rss.xml/route.ts`
- Create: `app/sitemap.xml/route.ts`, `app/robots.txt/route.ts`
- Create: `tests/e2e/feed.spec.ts`, `tests/e2e/search.spec.ts`

**Tasks:**

1. **`lib/feed/heat-score.ts`.** Implements S3 formula. Returns a SQL fragment usable in `order by`:
   ```sql
   (
     posts.like_count
     + 2 * posts.bookmark_count
     + 0.5 * posts.comment_count
     + case when exists (... tag overlap with caller ...) then 5 else 0 end
   ) / power(extract(epoch from (now() - posts.published_at)) / 3600 + 2, 1.5)
   ```
   Two variants: with `caller_id` (For You) and without (mixed feed for signed-out / generic).
2. **Homepage 3-column.** Per the spec: For You / Playbooks / Deep Dives columns, each top 10 by heat score (filter Playbooks col to `type=playbook`, Deep Dives to `type=dive`, For You to all types with caller tag-affinity). Below: mixed-heat feed paginated.
3. **For You signed-out fallback.** Show the generic mixed feed scored without tag-affinity (per S3 — no personalization for signed-out viewers).
4. **`/tag/[slug]/page.tsx`.** 404 if tag missing OR `is_approved = false` (unapproved tags don't get landing pages). Show tag name + description (none in v1 — just name), then list of posts ordered by heat score, paginated.
5. **`/search` page.** `?q=...` query param. Uses `websearch_to_tsquery('english', q)` against `posts.search_tsv`. Order by `ts_rank` desc. Paginated 20.
6. **Search box in nav.** Submitted via GET to `/search?q=...`.
7. **Site-wide RSS (`/rss.xml`).** Latest 20 non-deleted posts. Channel title "agentlab.in," item title = post title, description = summary, link = canonical URL, pubDate = published_at. ISR revalidate 5min.
8. **Per-author RSS (`/<username>/rss.xml`).** Filter by author.
9. **Per-tag RSS (`/tag/<slug>/rss.xml`).** Filter by tag (approved only).
10. **`/sitemap.xml`.** Sitemap index pointing to:
    - `/sitemap-posts.xml` — all non-deleted post URLs
    - `/sitemap-users.xml` — all non-deleted user URLs
    - `/sitemap-tags.xml` — all approved tag URLs
    ISR revalidate 1h.
11. **`/robots.txt`.** Allow all; sitemap reference.
12. **Tests.**
    - E2E: homepage renders 3 columns + mixed feed; signed-in user with tagged posts sees tag-affinity boost.
    - E2E: tag landing for "security" shows only security-tagged posts.
    - E2E: `/search?q=trust+gate` returns the trust-gate seed post.
    - Validate `/rss.xml` against a feed validator (e.g., `feedparser` smoke test in CI).

**Acceptance:**
- Homepage looks like the spec's 3-column + mixed-heat layout.
- Tag pages show only approved-tag posts.
- Search returns relevant hits via Postgres FTS.
- RSS feeds validate.
- Sitemap is reachable; robots.txt lets crawlers in.

---

## Phase 10 — Notifications

**Goal:** In-app inbox at `/notifications` with unread badge and per-event delivery.

**Depends on:** Phases 7, 6 (follow). Mostly wires up the emit points already noted in earlier phases.

**Files:**
- Create: `app/notifications/page.tsx`
- Create: `components/notifications/{NotificationItem,NotificationBadge}.tsx`
- Create: `app/api/notifications/route.ts` (GET list, PATCH mark-read)
- Create: `lib/notifications.ts` (creator helpers)
- Modify: comment + follow + tag emit points to call the creators
- Create: `tests/e2e/notifications.spec.ts`

**Tasks:**

1. **`lib/notifications.ts`.** Exports `notify(userId, kind, payload)` — inserts a row. Idempotency: skip if a notification of same `(user_id, kind, payload->>'sourceId')` exists in last 60s (prevents double-notify on rapid double-click).
2. **Emit points.**
   - Comment on a post → `comment` to post author (skip if commenter = author).
   - Reply to a comment → `reply` to parent author (skip if replier = parent author).
   - New follower → `follow` to followed user.
   - Tag approval/rejection (Phase 12) → `tag_approved` / `tag_rejected` to suggester.
   - Admin emits (Phase 12): `admin_report` and `admin_tag_pending` to all admins.
3. **`/notifications` page.** Auth required. List in chronological reverse, paginated. Each row shows kind-specific copy + link to the source.
4. **`NotificationBadge`.** Shows unread count on the nav; polls `/api/notifications?unread=true` every 60s when tab is focused. (No realtime in v1.)
5. **`PATCH /api/notifications`.** Body `{ ids: string[] }` → marks read. Also `{ all: true }` → marks all read.
6. **Tests.**
    - E2E: user A comments on user B's post → user B sees badge increment + notification.
    - E2E: user A follows user B → notification.
    - E2E: marking all read clears the badge.

**Acceptance:**
- Notifications appear for all six kinds.
- Unread badge reflects actual unread count.
- Mark-read works individually and bulk.

---

## Phase 11 — Org-Account Publishing (B2)

**Goal:** A user who belongs to a GitHub org sees that org as a publish-as option on `/write`, and articles authored under it route to `/<org-slug>/...`. Org identity is sourced live from GitHub — no agentlab-side roster management.

**Depends on:** Phases 1, 4, 6.

**Files:**
- Create: `supabase/migrations/0013_orgs.sql` (orgs + org_members + posts.org_id; pinned_posts XOR refactor; reports/mod_actions target_type extension)
- Create: `supabase/migrations/0021_github_orgs.sql` (orgs.github_org_id UNIQUE)
- Create: `lib/orgs/github-sync.ts` (sync GitHub orgs → `public.orgs` + `public.org_members` on sign-in)
- Modify: `lib/auth.ts` (add `read:org` scope; `events.signIn` calls `syncUserGithubOrgs`)
- Create: `components/editor/PublishAsSelect.tsx`
- Modify: `app/api/posts/route.ts`, `app/api/posts/[id]/route.ts` (accept + immutability-check `org_id`)
- Modify: `app/[username]/page.tsx`, `app/[username]/[type]/[slug]/page.tsx` (user-first, then org)
- Modify: `app/[username]/feed.xml/route.ts`, `app/sitemap.ts` (org branches)
- Modify: `components/post/PostCard.tsx`, `lib/posts/lookup.ts`, wikilinks resolver
- Modify: `components/settings/OrgsListSection.tsx` (read-only listing on `/settings/profile`)

**Tasks:**

1. **Schema (0013).** `orgs`, `org_members` (role kept for forward-compat; functionally only `'member'` under the GitHub model), `posts.org_id`, `pinned_posts` XOR refactor, RLS cascades so soft-deleted/banned orgs hide their posts.
2. **`github_org_id` column (0021).** UNIQUE bigint so login renames update the existing row instead of duplicating.
3. **GitHub org sync.** `syncUserGithubOrgs` calls `GET /user/orgs` with the user's OAuth token; materializes orgs not yet in DB; updates `display_name` / `avatar_url` / `bio` / `slug` on rename; upserts membership; prunes memberships removed from GitHub. Soft-deleted / banned orgs are skipped (admin moderation wins). 5s timeout, fail-soft on GitHub errors.
4. **Wire into auth flow.** `events.signIn` calls the sync after `ensurePublicUser` resolves; failures logged but never block sign-in. OAuth scope adds `read:org`; users who deny it keep signing in but see no orgs.
5. **`PublishAsSelect`.** Lists the caller's GitHub-backed orgs. `POST /api/posts` writes `org_id` after re-verifying membership.
6. **Org routing.** `/<slug>` resolves user-first, falls back to org. Org profile is read-only — `display_name` / `bio` / `avatar` come from GitHub. No agentlab-side edit form.
7. **Read-side surfaces.** `PostCard` byline, RSS, sitemap, JSON-LD `Organization`, wikilinks resolver all read org by slug.
8. **`/settings/profile#orgs`.** Read-only list of the caller's orgs with a View link. No Manage / Leave — those are GitHub actions.

**Out of scope:**
- A rename-redirect table for changed org logins (v1: old slug 404s; TODO inline).
- Caching the GitHub org list between sign-ins (one fetch per sign-in is fine).
- A "refresh my orgs" button (next sign-in does it).
- Multi-user admin roster on agentlab — membership IS GitHub membership.

**Acceptance:**
- A user belonging to a GitHub org sees it in `PublishAsSelect` after sign-in.
- Posting under that org lands at `/<org-slug>/<type>/<post-slug>` and the org byline renders on `PostCard`.
- Leaving the GitHub org → publish-as rights drop on next sign-in.
- Admin can ban an org via `/admin/orgs`; its posts disappear from public read paths.

---

## Phase 12 — Moderation & Admin

**Goal:** Admin (Harshit) can approve/reject tags, work the report queue, block users, and soft-delete posts. Report button live on posts, comments, users.

**Depends on:** Phases 4, 7. Notifications from Phase 10.

**Files:**
- Create: `app/admin/{page,tags/page,reports/page,users/page,posts/page}.tsx`
- Create: `app/api/admin/{tags,reports,users,posts}/route.ts` (and `[id]` variants)
- Create: `app/api/reports/route.ts`
- Create: `components/admin/{TagQueue,ReportQueue,UserSearch}.tsx`
- Modify: `lib/auth.ts` (add `requireAdmin` server helper)
- Modify: `components/post/ReportButton.tsx` (already used in Phase 7 for comments; now also surfaced on posts and profiles)
- Create: `tests/e2e/moderation.spec.ts`

**Tasks:**

1. **`requireAdmin` server helper.** Throws 403 if `session.user.github_login` ∉ `ADMIN_GITHUB_LOGINS`.
2. **`/admin` overview.** Counts: pending tags, open reports, signups in last 24h.
3. **`/admin/tags`.** Lists `tags WHERE is_approved = false`. Per row: approve, reject, merge-into (autocomplete picker). Actions emit `tag_approved`/`tag_rejected` notifications to `created_by`.
4. **Tag merge.** Set all `post_tags` rows for the rejected tag's id to the target tag's id (ignore duplicates), delete the rejected tag.
5. **`/admin/reports`.** Lists open reports, newest first. Per row: target (post/comment/user) preview, reason, reporter, "Resolve no action" / "Soft-delete target" / "Block user" actions. Sets `resolved_at`, `resolved_by`.
6. **`/admin/users`.** Search by GitHub login. Per user: block/unblock toggle. Blocking sets `users.is_blocked = true`; signed-in blocked users are signed out and their next sign-in is rejected.
7. **`/admin/posts`.** Search by title/author. Per row: soft-delete (admin path), sets `deleted_by = 'admin'`.
8. **`POST /api/reports`.** Auth required. Body `{ target_type, target_id, reason }`. Inserts row; emits `admin_report` notification to all admins.
9. **`ReportButton` surfaces.** Add to: post-page header (report post), each comment (already added in Phase 7), profile page (report user).
10. **Tests.**
    - E2E (admin): approve a pending tag → tag landing page now serves it.
    - E2E (admin): reject a tag → suggester gets a notification.
    - E2E: report a post → row in `reports`; admin sees it in queue.
    - E2E (admin): soft-delete a post via admin path → post page shows "removed for policy violation."
    - E2E (admin): block a user → user's next sign-in is rejected with "account blocked."

**Acceptance:**
- All admin pages reachable only by admin allowlist.
- Tag queue end-to-end works including merge.
- Report queue works for all three target types.
- Blocking a user takes effect immediately on next session check.

---

## Phase 13 — Polish: Theme, Responsiveness, A11y

**Goal:** Both themes work and persist; mobile responsive; Lighthouse a11y ≥ 95 on key pages.

**Depends on:** all prior content phases.

**Files:**
- Modify: `app/layout.tsx` (theme provider with persistence)
- Modify: `components/layout/ThemeToggle.tsx`
- Modify: `app/globals.css` (audit all color tokens in the `@theme inline` block)
- Modify: `app/globals.css` (focus rings, prefers-reduced-motion, prose styles)
- Modify: most components for keyboard + ARIA
- Create: `app/offline/page.tsx` (Vercel will serve when offline if PWA configured; v1 just a static page)
- Modify: `app/not-found.tsx`, `app/error.tsx`

**Tasks:**

1. **Theme persistence.** Read from localStorage on mount; SSR uses cookie hint to avoid FOUC. Toggle updates both.
2. **System-preference default.** First-visit reads `prefers-color-scheme`.
3. **Audit color contrast.** All text ≥ 4.5:1 contrast in both themes. Use Tailwind tokens; no inline colors.
4. **Mobile pass.** Editor stacks (no split pane below 768px). Homepage 3-col collapses to 1-col. Nav hamburger.
5. **Focus rings.** Visible focus on all interactive elements in both themes.
6. **Keyboard navigation.** Tab order makes sense; skip-link to main content.
7. **ARIA.** Buttons have labels; live regions for toast/notification updates; `aria-current` on nav.
8. **Reduced motion.** Wrap any animation in `@media (prefers-reduced-motion: no-preference)`.
9. **Prose styles.** Tailwind Typography plugin (`prose prose-invert`) for rendered post bodies, tuned to mono aesthetic.
10. **404 and 500 pages.** Themed, on-brand.
11. **Lighthouse run on homepage, post page, profile page.** Target ≥95 a11y, ≥90 performance.

**Acceptance:**
- Toggling theme persists across reloads and tabs.
- Mobile (375px wide) is usable for: read post, comment, sign in, browse feed, write post.
- Lighthouse a11y ≥ 95 on homepage, post page, profile page.

---

## Phase 14 — Pre-Launch Hardening

**Goal:** Rate limits, analytics, content-policy pages, image validation finalized.

**Depends on:** all prior.

**Files:**
- Create: `lib/rate-limit.ts`
- Modify: all POST API routes to call rate-limit
- Install: Vercel Analytics in `app/layout.tsx`
- Modify: `app/(marketing)/{privacy,terms,policy,support}/page.tsx` — accept text content from Harshit (he's drafting these)
- Modify: `app/about/page.tsx` — short brand statement
- Modify: `app/api/uploads/route.ts` — final validation (decompression bomb, MIME sniff)

**Tasks:**

1. **Rate limits.** Use Upstash Redis (free tier) or in-memory fallback. Limits:
   - Publish: 10 posts/24h
   - Edit: 60 patches/h
   - Comment: 30/h
   - Like / Bookmark / Follow toggles: 200/h
   - Report: 20/h
   - Upload: 30/h
   On exceed: 429 with `Retry-After`.
2. **Vercel Analytics.** Add `<Analytics />` to root layout.
3. **Policy pages.** Plug in Harshit-provided text for Privacy Policy, Terms of Use, Content Policy, Support page. If text not ready by phase start, ship placeholder copy with a clearly-marked "DRAFT — final text by launch" banner; replace before Phase 15.
4. **About page.** One paragraph: what agentlab.in is, content license (CC BY 4.0), GitHub link.
5. **Image upload final validation.** Decompression bomb protection (reject images that decompress >50MB raw); double-check MIME via byte sniff library (`file-type`); enforce ≤ 6000×6000 dimensions; strip EXIF via `sharp`.
6. **CC BY 4.0 footer.** Add to every post-page footer: "Content licensed under CC BY 4.0 — credit @<author>."

**Acceptance:**
- Burst of 11 publishes returns a 429 on the 11th.
- Vercel Analytics dashboard receives events.
- All four policy pages live with final text (no draft banner at launch).
- Image upload of a known decompression-bomb test file rejected.
- License footer on every post page.

---

## Phase 15 — Launch

**Goal:** agentlab.in is live, seeded with the first 1-2 original posts and 1 curated post.

**Depends on:** all prior.

**Files:**
- Run only — no new code files.

**Tasks:**

1. **Final manual QA pass.** Run through the golden paths:
   - Fresh user signs in.
   - Writes and publishes a Post.
   - Comments, likes, bookmarks the seed post.
   - Submits a new tag → appears in admin queue.
   - Admin approves it → tag landing page works.
   - Follows another user → notification.
   - Org publishing as `agentlab-in` works.
   - Mobile read flow works.
2. **DNS / Vercel cutover.** Confirm `agentlab.in` apex domain points at the Vercel production deployment.
3. **Provision `agentlab-in` org.** Harshit signs in, claims the org via `/orgs/claim`. (Pre-requirement: GitHub org `agentlab-in` must exist and Harshit must be admin — user has confirmed.)
4. **Write & publish seed content.** 1-2 posts under `@harshitsinghbhandari` (real Aegis / Donna work), 1 distilled post under `@agentlab-in`. Following the spec's distillation policy.
5. **Configure Vercel Analytics dashboard.** Set up traffic alerts.
6. **Smoke-monitor for 24h.** Check error logs (Vercel function logs), check for 5xx, watch sign-up rate, watch report queue.
7. **Launch channels.** Harshit drives — HN, Twitter, ProductHunt, agent-adjacent communities. Not in scope of this plan.

**Acceptance:**
- `https://agentlab.in` serves the homepage, with the three seed posts visible in the heat feed.
- New user (not Harshit) can sign in and publish a post end-to-end.
- No 5xx errors in the first hour of traffic.

---

# Cross-Cutting Concerns

## Migrations Strategy

Single Supabase project (`agentlab-prod`). Migrations applied via `supabase db push` from a developer machine — there is no migration-on-deploy automation in v1. Process:

1. Add migration SQL to `supabase/migrations/`.
2. Run locally against a dev branch DB to validate.
3. PR with migration file + code changes.
4. After merge, manually run `supabase db push --linked` against prod from local.
5. Confirm via `supabase db diff`.

Risk: schema and code can drift if push is skipped. Mitigation: pre-merge checklist enforces "did you push the migration."

## Secrets

All secrets in Vercel env vars (Production + Preview):

- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ADMIN_GITHUB_LOGINS=harshitsinghbhandari`
- `UPSTASH_REDIS_URL` (Phase 14, optional — in-memory fallback acceptable for v1)

`.env.example` ships with placeholders; `.env.local` is gitignored.

## Performance

- All read pages use Next.js RSC + Supabase server client (service role for admin paths, anon for public read paths).
- Heat-score query has indexes on `(type, published_at)` and `(post_id)` for joins. Re-check query plan via `EXPLAIN` once seed data > 100 posts.
- Cover images served from Supabase Storage with CDN caching.
- Mermaid lazy-loaded only when a post body contains `class="language-mermaid"`.

## Security

- All mutations behind `getServerSession()` + role check where needed.
- HTML sanitized via `rehype-sanitize` with a schema-locked allowlist.
- Comments are plain text — no markdown means no rendering attack surface beyond text-node escaping (which React does by default).
- Rate limits on every POST.
- CSP header in `next.config.mjs`: `default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; frame-src https://www.youtube.com https://twitter.com https://gist.github.com`.

## Testing

- Unit tests (Vitest): all pure logic — `slug`, `wikilinks`, `heat-score`, `reserved-names`, `mdx/sanitize`.
- E2E tests (Playwright): the user-facing flows listed under each phase.
- CI runs both on every PR. Merging requires green.
- Manual QA before Phase 15.

---

# Self-Review

**Spec coverage** (against Discussion #2 + Issue #4 answers):

| Spec area | Phase(s) |
|---|---|
| GitHub OAuth | 1 |
| Sign-up gate (≥30d, ≥1 repo) | 1 |
| Username = GitHub login | 1 |
| Org accounts | 11 |
| Curator `agentlab-in` | 11, 15 |
| Post / Playbook / Deep Dive structures (Post = renamed from spec's "Pattern") | 3, 4 |
| Required fields | 3 |
| Split-pane editor | 3 |
| localStorage drafts | 3 |
| MDX + allowlist | 3 |
| Edit history (timestamps, no browser) | 4 |
| Prism, Mermaid | 3 |
| Image upload + Supabase Storage | 3, 14 |
| URL `/<user>/<type>/<slug>` | 4, 5 |
| Curated nested tags, max 5 | 3, 4, 12 |
| Tag landing | 9 |
| Featured starter tags | 2 |
| Homepage 3-col + mixed | 9 |
| Heat-ranked "For You" | 9 |
| Postgres FTS | 2, 9 |
| RSS, sitemap, robots | 9 |
| Threaded comments | 7 |
| Likes (single heart) | 8 |
| Bookmarks (flagship, private) | 8 |
| Follow authors | 6 |
| View counts (author only) | 5 |
| Related posts (tag overlap) | 5 |
| `[[wikilinks]]` + "Referenced by" | 4, 5 |
| Community flagging + admin | 12 |
| Report button (posts, comments, users) | 7, 12 |
| Author delete | 4 |
| Plagiarism / attribution | 14 (policy text) |
| Distillation under `@agentlab-in` | 11 |
| Vercel.com dark aesthetic | 0, 13 |
| Dark + light themes | 13 |
| Mono typography | 0, 13 |
| Profile pages (avatar, bio, posts, pinned, stats) | 6 |
| ~~GitHub repos on profile~~ | DROPPED (user override) |
| Username changes never | 1 |
| Next.js 16, Tailwind v4, NextAuth, Supabase ap-south-1 | 0, 1, 2 |
| Vercel hosting | 0 |
| Vercel Analytics | 14 |
| ~~Staging branch~~ | DROPPED (user override) |
| CC BY 4.0 | 14 |
| Pre-launch policy pages | 14 |

No spec gaps. Three intentional omissions: GitHub-repos block, staging branch, comment markdown — all per explicit user overrides on Issue #4.

**Placeholder scan:** No "TBD", "TODO", "implement later" patterns in tasks. The policy-page TEXT is the only "DRAFT" item, and it's explicitly authored by Harshit before launch with a fallback banner if late.

**Type / name consistency:** Reviewed type names (`post|playbook|dive`) — URL segments and DB enum values match, no mapping layer needed. `lib/posts/url.ts` is now a thin helper around URL construction only. Comment `depth` field is denormalized for query speed (used in Phases 2, 7).

---

# Execution Handoff

Plan complete and saved to `docs/v1-plan.md`. Per the orchestrator's instruction, NOT opening a PR — user reviews the plan first.

Two execution options once the plan is approved:

1. **Subagent-Driven (recommended for this size)** — dispatch a fresh subagent per phase, review between phases, fast iteration. Plan structure is already phase-shaped for this.
2. **Inline Execution** — work each phase in a single session using `superpowers:executing-plans` with checkpoints.

When the plan is approved, ack and pick an approach.
