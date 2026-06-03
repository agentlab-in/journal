# Pre-launch security audit — agentlab.in `develop`

**Date:** 2026-06-01
**Auditor:** lead + 7 parallel specialty sub-agents
**Branch audited:** `develop` @ `e80af3b` (post Phase-14 + SEO + post-review-fixes)
**Out of scope:** `feat/phase-11-orgs`, `docs/cli-and-api-plan`, `legal`/PR #34 (not merged), production runtime mutation
**Methodology:** read-only static analysis; one live probe of `https://dev.agentlab.in` for header capture (no destructive payloads)

---

## TL;DR — go / no-go

**No-go as-is.** Seven CRITICAL findings (C1–C7) span moderation data exposure (RLS on `public.users`), arbitrary-host image references on user profiles, missing CSP, a preview environment that shares prod's admin powers, and a ban-enforcement race window that lets a banned user keep posting until their session row is hand-deleted. None require a sophisticated attacker; several are reachable from any browser tab with the public Supabase anon key.

That said, the heavy lifting that's already in place is good: NextAuth + Supabase adapter is wired correctly; rate-limit infrastructure exists; MDX is sanitized through `rehype-sanitize`; the upload pipeline strips EXIF and re-encodes via Sharp; `requireAdmin` returns 404 (not 403) to hide the admin surface. The CRITICAL findings are tractable patches, not architecture rewrites. **Recommendation:** treat C1–C7 as launch blockers, ship the H-tier fixes within the first week, then schedule the M-tier in a hardening sprint.

`pnpm audit` is clean of HIGH/CRITICAL CVEs (2 moderates, both with bounded impact in this codebase). No secrets in git history. No server-only env vars leaked to client bundles.

---

## Severity scale

- **CRITICAL** — auth bypass, RCE, mass-data exfil, admin escalation, RLS bypass with PII access.
- **HIGH** — IDOR with material impact, stored XSS, SSRF to internal services, DoS that requires no auth.
- **MEDIUM** — limited-scope IDOR, self-XSS, info disclosure of non-PII, rate-limit bypass.
- **LOW / Nit** — defense-in-depth gaps, missing best-practice headers without a current exploit chain.

---

## CRITICAL — launch blockers

### C1 — `public.users` RLS exposes ban reasons, mod attribution, signup heuristics to anyone with the anon key
**Files:** `supabase/migrations/0002_content.sql:398-402`, `0011_moderation.sql:27-29`, `0012_signup_flags.sql:9-11`
**Attacker model:** anyone on the internet — the anon key ships in `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

The policy `CREATE POLICY users_public_read ON public.users FOR SELECT USING (true)` predates Phase 11/12/14, which added `banned_at`, `banned_reason`, `banned_by`, `signup_flags` directly to the same table. RLS in Postgres is row-level — adding columns does not narrow the policy. Any client can run

```js
supabase.from('users').select('username, banned_at, banned_reason, banned_by, signup_flags')
```

against the public REST endpoint and pull every ban reason (which may include free-form mod notes like "doxxing accusation reported by X"), which admin actioned which ban (deanonymizing the mod team), and the platform's abuse heuristics (`signup_flags.thin_profile` etc.).

**Fix:** create `public.users_public` view exposing only `id, username, display_name, bio, avatar_url, github_login, follower_count, following_count, created_at`, revoke SELECT on the base table from `anon` and `authenticated`, repoint Supabase clients in `lib/profile/lookup.ts`, `lib/feed/*`, and others to the view. Service-role keeps full access for admin/server.

### C2 — `/auth/blocked` page renders `banned_reason` for any GitHub login (anonymous enumeration)
**File:** `app/auth/blocked/page.tsx:141-165`
**Attacker model:** anonymous.

`GET /auth/blocked?reason=banned&login=<victim>` reads `banned_reason` via the service-role client and renders it in the page body with no check that the requester is the banned user. Anyone can enumerate ban reasons for any GitHub login. Combined with C1 this is two independent leaks of the same data.

**Fix:** require an authenticated session whose `username === safeLogin` before rendering `bannedReason`; otherwise show generic copy.

### C3 — Avatar URL accepts any `https://` host → tracking pixel + arbitrary content in OG cards, social unfurls, in-page renders
**Files:** `app/api/users/me/route.ts:17-20`, `components/profile/ProfileHeader.tsx:69-75`, `app/[username]/page.tsx:44,56,63`
**Attacker model:** any signed-in user.

`AvatarUrlField` Zod validator is `z.string().refine(s => s.startsWith('https://'))`. The value is written to `public.users.avatar_url` and flows into:
- `openGraph.images` and `twitter.images` for the profile page metadata — every Slack/Discord/Mastodon/Twitter/Facebook/Google preview fetches the URL.
- A raw `<img src={avatarUrl}>` in `ProfileHeader.tsx` (eslint `no-img-element` is disabled, bypassing `next/image` `remotePatterns`).

An attacker `PATCH /api/users/me {"avatar_url":"https://attacker.example/pixel.gif?profile=victim"}` gets IP logs every time anyone shares their profile, can serve NSFW/illegal imagery that gets cached under the agentlab.in attribution, and can return different content per requester.

**Fix:** validate against a parsed URL allowlist:
```ts
const u = new URL(val);
const supa = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
return (u.origin === supa.origin && u.pathname.startsWith('/storage/v1/object/public/avatars/'))
    || (u.origin === 'https://avatars.githubusercontent.com' && u.pathname.startsWith('/u/'));
```
Reject `..` segments after `new URL` normalization. Restore `next/image` for avatars; remove the eslint disable.

### C4 — No CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, no `X-Frame-Options`, no `Permissions-Policy`
**File:** `next.config.ts` (no `headers()` block; no top-level `middleware.ts`)
**Attacker model:** any future stored-XSS escape, framing/clickjacking, MIME sniffing on uploaded assets.

Live probe of `https://dev.agentlab.in/` returned only `strict-transport-security: max-age=63072000` (Vercel default). The MDX sanitizer is the *only* layer between a user post and full XSS — there is no defense-in-depth. The Embed component, Mermaid client render, and stored-then-replayed `body_html` (see H12) each represent regression-prone XSS sinks, and a single regression means full-page script execution.

**Fix:** add `async headers()` in `next.config.ts`. Suggested baseline:
- `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-${nonce}'; img-src 'self' data: https://<supabase-project>.supabase.co https://avatars.githubusercontent.com; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';` (start in Report-Only for one week to catch regressions, then enforce).
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- `X-Frame-Options: DENY`

### C5 — dev.agentlab.in preview is the full app, no auth gate, same `ADMIN_GITHUB_LOGINS` and same Supabase project as production
**Files:** `lib/auth.ts:139-145`, audit prompt's deployment notes
**Attacker model:** anyone who compromises a single GitHub OAuth session belonging to an admin (phishing, device theft, GitHub session hijack).

`/admin/*` and `/api/admin/*` are reachable on dev. `isAdmin()` reads `ADMIN_GITHUB_LOGINS` from env per request; if the Vercel preview environment inherits the prod value (which the audit notes imply), an admin authenticates on dev and exercises ban / tag-approval / report-resolution authority **against the same Supabase database as production**. The user has explicitly declined a basic-auth gate on dev, so the attack surface is wide open.

**Fix (pick at least one):**
1. Use a separate Supabase project for preview/dev — cleanest. Production data isn't reachable from `dev.agentlab.in` at all.
2. In `lib/admin.ts`, hard-refuse admin when `process.env.VERCEL_ENV !== 'production'`.
3. Add `Disallow: /` and `X-Robots-Tag: noindex, nofollow` on dev so search engines don't surface it (orthogonal but related).

### C6 — Banned users keep posting until their session row is hand-deleted; no per-request `banned_at` check on mutating routes
**Files:** `lib/auth.ts:420-444`, `app/api/admin/ban/route.ts:78-91`, every `app/api/*` mutating route
**Attacker model:** a user being banned in real time, or any banned user with a still-live NextAuth session cookie (session lifetime defaults to 30 days).

`signIn` callback enforces `banned_at IS NULL` *only on a fresh OAuth handshake*. The ban admin endpoint UPDATEs `users.banned_at` and then attempts `next_auth.sessions.delete().eq('userId', target_user_id)` (`app/api/admin/ban/route.ts:85-91`). Three issues:
1. The two writes are not transactional — a request in flight between the UPDATE and the DELETE authenticates fine.
2. The route **logs but does not surface** a session-delete failure (`sessionsErr`) and still returns `ok: true`. A moderator believes the user is locked out while the session row persists indefinitely.
3. No request-time check of `users.banned_at` exists in `POST /api/posts`, `PATCH /api/posts/[id]`, `POST /api/comments`, `POST /api/likes/[postId]`, `POST /api/bookmarks/[postId]`, `POST /api/follows/[userId]`, `POST /api/reports`, `PATCH /api/users/me`, `POST /api/uploads`, `POST /api/pinned-posts`.

**Fix:**
1. Make ban transactional via a Postgres function that updates `users.banned_at` and DELETEs from `next_auth.sessions` in one transaction. Surface errors to the moderator UI; do not return 200 on partial failure.
2. Add a `users_session_invalidator` trigger on `users` that DELETEs `next_auth.sessions WHERE userId = NEW.id` when `banned_at` flips from NULL to NOT NULL. Defense-in-depth: even if admin code forgets, sessions get nuked.
3. In `getSession()` (`lib/auth.ts`), augment with one `SELECT banned_at FROM users WHERE id = ?` and return null/throw if non-null. One extra round-trip per authenticated request — acceptable.

### C7 — RLS on `pinned_posts` and `comments` doesn't gate on parent post's `deleted_at` → soft-deleted moderation content stays world-readable
**Files:** `supabase/migrations/0002_content.sql:630-634`, `0002_content.sql:672-677`
**Attacker model:** anonymous, with the public anon key.

- `pinned_posts` policy: `FOR SELECT USING (true)` unconditionally. Any client can `supabase.from('pinned_posts').select('user_id, post_id')` and correlate pins to posts the public RLS hides. Existence + author binding of soft-deleted posts is leaked.
- `comments` policy filters on `comments.deleted_at IS NULL` but not on the parent `posts.deleted_at`. When a moderator soft-deletes a post (e.g. doxxing, illegal content), every comment underneath remains anon-readable directly via Supabase REST.

App-layer code in `CommentsSection.tsx` filters correctly; the gap is purely at the REST surface.

**Fix:** rewrite both policies to `EXISTS (SELECT 1 FROM posts p WHERE p.id = <fk> AND p.deleted_at IS NULL)`. `post_tags` already does this — same pattern.

---

## HIGH

### H1 — `isValidCoverImageUrl` uses `startsWith` only — `..` path traversal in normalized URL escapes the covers bucket
**File:** `lib/posts/cover-image.ts:1-6`
**Attacker:** any signed-in author.

`expectedPrefix = ${SUPABASE_URL}/storage/v1/object/public/covers/` and validation is `url.startsWith(prefix)`. WHATWG URL normalisation collapses `..` segments at fetch time. A URL like `${SUPABASE_URL}/storage/v1/object/public/covers/../authenticated/<private-bucket>/<key>.png` passes the validator but `next/image` and crawlers fetch `…/authenticated/<private-bucket>/<key>.png`. Today that bucket returns 401 without service-role, but one config change ("make the brand assets bucket public") flips this into info disclosure.

**Fix:** parse with `new URL(url)`, require `parsed.origin === new URL(SUPABASE_URL).origin && parsed.pathname.startsWith('/storage/v1/object/public/covers/') && !parsed.pathname.includes('/../')`.

### H2 — PostgREST `.or()` filter injection in `/api/tags/search`
**File:** `app/api/tags/search/route.ts:53-55`
**Attacker:** anonymous.

User `q` is LIKE-escaped (`\`, `%`, `_`) but interpolated into a multi-clause PostgREST `.or()` string: `builder.or(`slug.ilike.${pattern},name.ilike.${pattern}`)`. PostgREST parses `.or()` as a comma-separated list of predicates. A request like `?q=,is_approved.eq.false,parent_tag_slug.not.is.null` injects predicates into the OR group. Because it's AND-combined with `.eq('is_approved', true)` on the outside, attackers cannot directly leak unapproved tags this way — but they can (a) cause 500s with invalid PostgREST syntax, (b) emit predicates that hit non-indexed columns to amplify cost, (c) probe column metadata via differential 200/500 responses.

**Fix:** strip `,()`.`:` from `q` before composing the string, or replace `.or()` with two separate `.ilike()` queries unioned client-side.

### H3 — `/api/posts/[id]/view` — anonymous, no rate limit, no UUID validation, no IP bucket
**Files:** `app/api/posts/[id]/view/route.ts:20-37`, `supabase/migrations/0004_view_count_rpc.sql:12-24`
**Attacker:** anonymous, with any browser.

Origin guard runs but `isAllowedOrigin` accepts `https://agentlab.in` — trivially forged by anything that isn't a browser, since `Origin` is not a credential. The handler calls `increment_post_view_count(p_id)` on every hit; `view_count` feeds the home-feed heat formula (`lib/heat.ts`). A single attacker can rank-manipulate by pumping views, and the `UPDATE posts SET view_count = view_count + 1` serializes per-row in Postgres, so a hot post becomes a contention point.

**Fix:** add an IP-keyed token bucket in `middleware.ts`; validate UUID shape; consider moving to an insert-only `views` table keyed by `(post_id, viewer_session, day)` with periodic rollups.

### H4 — `/api/mdx/preview` has no rate-limit bucket — authenticated CPU bomb
**File:** `app/api/mdx/preview/route.ts:58`
**Attacker:** any authenticated user.

`guardMutatingRequest(req, { userId })` is called without `bucket`, so the limiter is skipped (`route-guard.ts:60` requires both fields). The handler compiles up to 100k chars of MDX through `next-mdx-remote/serialize` (synchronous Node VM) on every request. A signed-in attacker can fire 100/s and pin Vercel function CPU; the editor debounces at 300ms client-side but server enforcement is what matters.

**Fix:** add an `mdx_preview` bucket at e.g. 60/min/user.

### H5 — Publish path: N sequential wikilink resolves + 200k MDX compile, no timeout, 10/h budget per user
**Files:** `app/api/posts/route.ts:146-166`, `lib/posts/wikilinks-resolve.ts:34`, `lib/posts/wikilinks-extract.ts:7-9`
**Attacker:** authenticated, post sign-up gate.

`extractWikilinkAnchors` runs two full-body regex passes on 200k chars, then `resolveAnchor` is called **sequentially** per unique anchor (each is a Supabase round-trip). An attacker embeds 10k distinct `[[anchor-N]]` and burns the publish budget (10/h) on 10k DB queries + a full MDX render. Likely cumulative with Vercel function time limits.

**Fix:** cap `anchors.length` to e.g. 100; batch resolution into one `IN`-query; wrap `renderToHtml` in a 10s `Promise.race` timeout. Same applies to `PATCH /api/posts/[id]` (30/h bucket, even worse).

### H6 — Upstash failure path bubbles unhandled rejection → mass 500s when Redis flaps
**Files:** `lib/rate-limit.ts:173-183`, `lib/route-guard.ts:61`
**Attacker:** none required; Upstash availability event triggers it.

`await limiter.limit(identifier)` is not wrapped in try/catch in `route-guard.ts`. Upstash REST 5xx or DNS blip rejects the promise; mutating routes return 500 with no graceful policy. Worse, in-memory fallback (`memoryStore`) only activates when `UPSTASH_REDIS_REST_URL` is unset at module load — not at request-time failure.

**Fix:** wrap `limiter.limit` in try/catch with explicit `fail: 'open' | 'closed'` policy (recommend fail-open with a kill-switch env var); add a 1s timeout to the Upstash call; alert on fallback activation.

### H7 — Phase 14 "origin-check middleware" is per-handler — there is no real middleware
**Files:** `lib/route-guard.ts:40`, repo root (no `middleware.ts`)
**Attacker:** any future contributor who forgets to call `guardMutatingRequest`.

`find . -name middleware.ts -not -path "*/node_modules/*" → 0 results`. CSRF protection lives in a helper that handlers must remember to invoke. Today's coverage is OK, but the design is fragile — any new POST/PATCH/DELETE route is one merge away from being CSRF-vulnerable.

**Fix:** add `middleware.ts` at repo root that enforces `isAllowedOrigin` on all `POST|PUT|PATCH|DELETE` requests under `/api/*` as a backstop. Per-handler call remains for finer policy (rate-limit bucket selection).

### H8 — `robots.txt` advertises `/admin`, `/write`, `/settings`, `/api`, `/auth/blocked`, `/auth/signin`
**File:** `app/robots.ts:9`
**Attacker:** anyone reading `/robots.txt` (reconnaissance).

The `requireAdmin → notFound()` pattern in `lib/admin.ts:32` is intentionally designed so non-admins cannot tell `/admin` exists. `robots.txt` undoes this misdirection — every interesting attack surface is enumerated.

**Fix:** collapse to `Disallow: /api/` (search engines don't index 404s anyway). The admin/write/settings paths are protected at the route handler — they don't need crawler disallow.

### H9 — Mermaid client-side render has no diagram-size cap → in-browser DoS for every viewer
**Files:** `lib/mdx/MermaidBlock.tsx:60-84`, `lib/mdx/components.tsx:200-217`
**Attacker:** authenticated author; victim is any reader.

`securityLevel: 'strict'` is correctly set (no SVG `<script>` escape). But there's no length cap on the fenced mermaid block string. The overall `body_md` cap is 200k chars; a `graph LR; A0-->A1; A1-->A2; …` of ~10k nodes fits, compiles fine, and hangs the viewer's main thread for tens of seconds. ErrorBoundary catches throws, not slow renders.

**Fix:** hard cap at e.g. 8 000 chars in `PreWithMermaid`. Pass `maxEdges: 500` to mermaid init. For blocks > 2 000 chars, defer behind a "click to render" affordance.

### H10 — `/api/users/me` `bio` field is not server-side sanitized
**File:** `app/api/users/me/route.ts:16`
**Attacker:** any signed-in user.

`BioField = z.string().max(2000).nullable()` — no HTML/markdown sanitization. The bio gets rendered on profile pages. If rendering uses the same MDX/markdown allowlist as posts, this is OK; if it uses a permissive markdown renderer or `dangerouslySetInnerHTML` without sanitization, stored XSS.

**Fix:** route the bio through `lib/comments/sanitize.ts` (or whichever sanitizer covers profile fields) before insert. Verify the render path in `components/profile/ProfileHeader.tsx`.

### H11 — `/api/uploads` parses the full multipart body before checking `Content-Length` / `file.size`
**File:** `app/api/uploads/route.ts:70-87`
**Attacker:** any signed-in user.

`await req.formData()` materializes the entire body into memory before line 81's size check runs. Within Vercel's 4.5MB body cap, an attacker can POST 20×/h × ~3MB → memory pressure, then Sharp `metadata()` reads attacker-controlled bytes before the dimension check.

**Fix:** reject `Content-Length > MAX_BYTES + slop` before parsing the body. Stream the body to a temp file with a hard byte counter, or use `req.body` with a `ReadableStream` + size guard.

### H12 — Stored `body_html` is replayed via `dangerouslySetInnerHTML` and never re-sanitized on read
**Files:** `components/posts/PostBodyStatic.tsx:14`, `lib/posts/lookup.ts:142`
**Attacker:** future-you when the sanitize schema regresses.

`body_html` is computed at create/update and stored. If a future change widens the allowlist (e.g. someone adds `<iframe>` for a beta embed), every historical row replays under whatever schema was active at compile time, with no audit of how that compiled output behaves under the *current* renderer expectations. There's no `sanitize_version` column to identify rows requiring recompile.

**Fix:** either (a) drop `body_html` from the DB and call `renderToHtml(body_md)` on read (with cache), or (b) add `sanitize_version` and a periodic re-sanitize sweep.

### H13 — `CommentsSection` fetches all comments for a post — no `.limit()`
**File:** `components/post/CommentsSection.tsx:37-43`
**Attacker:** anonymous; victim is server CPU + Supabase egress.

Server-side `admin.from('comments').select(...).eq('post_id', postId).order(...)` has no limit. A post with 5 000+ comments (collusion, scripting, time) returns multi-megabyte JSON on every render. Combined with no IP rate-limit on anonymous reads, one adversary plus many IPs is a DB-egress amplifier.

**Fix:** `.limit(500)` + paginate with "Load more"; add IP rate limit at edge middleware for `/[username]/[type]/[slug]`.

### H14 — `Embed` host-allowlist uses substring `endsWith('twitter.com')` → matches `aaa-twitter.com`
**Files:** `lib/mdx/components.tsx:82`, `lib/mdx/oembed.ts:29-30`
**Attacker:** authenticated author.

`safeHost('https://aaa-twitter.com/foo').endsWith('twitter.com') === true`. Today this only forces a Fallback render (the oembed list uses exact `Set` membership, which is safe), but the inconsistency is a sharp edge — a future change that trusts `Embed`'s host classification path would be exploitable.

**Fix:** `host === 'twitter.com' || host.endsWith('.twitter.com')` everywhere.

### H15 — `/api/posts/[id]/view` POST plus `OPTIONS` confirm route existence; non-UUID IDs raise to a 500
**File:** `app/api/posts/[id]/view/route.ts:20-37`
**Attacker:** anonymous reconnaissance.

Cross-cuts H3 — even after rate-limiting, the route currently leaks "this id doesn't exist" via 500 vs "this origin is wrong" via 403. Differential responses give recon.

**Fix:** return 204 unconditionally (the route is fire-and-forget); validate UUID shape and 204 on invalid.

---

## MEDIUM

- **M1 — Re-ban evasion via second GitHub account.** `lib/auth.ts:420-442`. Ban keys on `public.users.id`; no email/IP/`providerAccountId` fingerprint persisted. Aged GitHub accounts are commodity. **Fix:** persist `hash(email)` and `accounts.providerAccountId` on ban; deny matching second accounts.
- **M2 — `/api/health` uses service-role Supabase client.** `app/api/health/route.ts:23`. Unauth route with no RL instantiating service-role. **Fix:** use anon client + dedicated `is_alive` view.
- **M3 — NextAuth cookie config not customised.** `lib/auth.ts:280-290`. Defaults are fine but a future "make subdomain auth work" change could set `domain: '.agentlab.in'` and silently share cookies between dev and prod. **Fix:** explicit `cookies` block pinning `sameSite: 'lax'` and omitting `domain`.
- **M4 — `mod_actions.target_id` is `text` — stringly-typed across post/user/tag/comment.** `supabase/migrations/0002_content.sql:360-369`. Audit integrity hazard. **Fix:** split into typed columns with a `CHECK` for exactly-one-set.
- **M5 — `cap_post_versions` trigger + app-computed `version_no` race.** `supabase/migrations/0002_content.sql:190-212`, `app/api/posts/[id]/route.ts:171-175`. Concurrent PATCHes can compute the same `version_no` and hit a unique-violation. **Fix:** derive `version_no` inside the INSERT (`SELECT coalesce(max(version_no),0)+1`).
- **M6 — SELECT-then-INSERT TOCTOU on slug suffixing.** `lib/posts/slug-collision.ts:14-26`. Concurrent posts produce 500 instead of a fresh suffix. **Fix:** catch 23505, retry.
- **M7 — Sharp `processImage` has no `limitInputPixels` / `failOn: 'error'` / animated-frame guard.** `lib/uploads/process.ts:40-46`. Today bounded by the upstream dimension/size checks, but a future code path passing `{animated: true}` would be a DoS sink. **Fix:** `sharp(input, { limitInputPixels: 36_000_000, failOn: 'error', sequentialRead: true })`.
- **M8 — `SECURITY DEFINER` RPCs (`search_posts`, `increment_post_view_count`, `comment_depth_for_parent`) grant `EXECUTE` to `anon`.** Reachable directly via Supabase REST; the Next.js API rate limits don't apply. **Fix:** review whether each RPC needs `EXECUTE TO anon` or can be restricted to `authenticated`; consider PostgREST `request.header('x-forwarded-for')`-keyed throttling.
- **M9 — `signIn` ban-check fail-open on Supabase error.** `lib/auth.ts:432-442`. Intentional but pairs badly with C6. **Fix:** fail-closed once C6 is in (the per-request check becomes the backstop, so signIn can be strict).
- **M10 — Anonymous reads not IP-rate-limited.** Every `/[user]/[type]/[slug]`, `/search`, `/api/tags/search`, `/feed.xml`, `/sitemap.xml`, RSS, and homepage hit is anonymous and unlimited. **Fix:** edge middleware with a permissive IP bucket (e.g. 600/min/IP).
- **M11 — `runSearch` and `/api/tags/search` accept unbounded `q.length`.** `lib/search/query.ts:51`, `app/api/tags/search/route.ts:42-55`. Postgres `ts_headline` + GIN scans are not free. **Fix:** cap `q` to 200 / 64 chars respectively; strip ` `.
- **M12 — `renderToHtml` / `extractStructuredSections` have no wall-clock budget.** `app/api/posts/route.ts:69,164`. Adversarial nesting of tables/fences could be superlinear. **Fix:** wrap in 10s `Promise.race`.
- **M13 — `ADMIN_GITHUB_LOGINS` not validated at startup.** `lib/env.ts`, `lib/auth.ts:139-145`. A typo silently locks out admins or grants access to an unintended handle. **Fix:** parse + require at least one entry in `production`; log the list once at boot.
- **M14 — Public RSC reads use service-role admin client unnecessarily.** `lib/profile/lookup.ts`, `lib/posts/lookup.ts`, `lib/feed/affinity.ts:243`, `lib/feed/index.ts:163`. Bypasses defense-in-depth that the `users: public read` RLS was supposed to provide. **Fix:** switch to `createAnonServerSupabaseClient()` for public reads; reserve service-role for mutations and admin paths.
- **M15 — Error log redaction misses `email`, `ip_address`, `ip$`.** `lib/logging/error-log.ts:54`. Current pattern catches `authorization|token|secret|password|cookie|api[_-]?key`. Confirm no call-site stuffs `email`/`ip` into `extra`. **Fix:** extend the regex; add a unit test that scans `app/api/**` for forbidden keys.
- **M16 — Comment depth RPC counts soft-deleted ancestors.** `supabase/migrations/0007_comments_count_and_depth.sql:76-92`. Likely intended, but document. No security exposure.
- **M17 — `signup_flags.thin_profile` is a single weak heuristic.** `lib/auth/soft-flag.ts:34-40`. A bot with 2 followers + a non-empty bio sails through. **Fix:** add account-age + repo-count thresholds for the flag; expand moderation triage.

---

## LOW / nits

- **L1 — `CVE-2026-41305` `postcss@8.4.31` (moderate 6.1).** Transitive via Next. Not exploitable today (no user-supplied CSS) but cleared by `pnpm.overrides`. See pnpm audit summary below.
- **L2 — `CVE-2026-41907` `uuid@8.3.2` (moderate 7.5).** Not reachable — `next-auth` calls `uuid.v4()` with no buffer arg. Document and ignore until next-auth v5 migration.
- **L3 — `x-powered-by: Next.js` header.** `next.config.ts:19`. Set `poweredByHeader: false`.
- **L4 — Dev preview emits prod canonical URLs in sitemap + robots.** `lib/site-url.ts:8`. Combined with C5: dev is crawlable and looks like prod. **Fix:** preview-env `X-Robots-Tag: noindex, nofollow`.
- **L5 — `fetchGithubLoginById` interpolates `providerAccountId` into URL with no `/^\d+$/` check.** `lib/users/ensure-public-user.ts:35`. Bounded to api.github.com so SSRF-free, but worth tightening.
- **L6 — `RESERVED_USERNAMES` has no CI test against `app/*` top-level segments.** `lib/reserved-names.ts:151-153`. **Fix:** add a unit test asserting every `app/<dir>/page.tsx` segment is in the reserved set.
- **L7 — `requireAdmin` returns 404 to non-admin authed users but `requireAdminApi` returns asymmetric JSON.** `lib/admin.ts:36,60`. Minor reconnaissance leak. **Fix:** return 404 for unauth too.
- **L8 — `isAllowedOrigin` hardcodes `http://localhost:3010`.** `lib/security/origin-check.ts:15`. Cosmetic. Gate on `NODE_ENV !== 'production'`.
- **L9 — `NEXTAUTH_SECRET` marked optional in `lib/env.ts:18`.** Build must not succeed without it in prod. **Fix:** require in production.
- **L10 — `srcSet` lacks protocol filter in MDX sanitize.** `lib/mdx/sanitize.ts`. Browsers reject `javascript:` in srcset, but defense-in-depth: `protocols: { srcSet: ['http','https'] }`.
- **L11 — RSS feed re-renders sanitized `body_html`.** `lib/atom.ts:56`. Anything that survives our sanitize gets re-rendered in feed readers. Cosmetic — flag in dev docs.
- **L12 — `lib/auth.ts` E2E shim trusts `x-e2e-auth: 1` header + env var, gated on `NODE_ENV !== 'production'`.** `lib/auth.ts:563-593`. Vercel preview is `NODE_ENV=production` so safe today, but a non-Vercel preview that runs `pnpm dev` and inherits the env var becomes a session-forgery primitive. **Fix:** also gate on `VERCEL_ENV === 'production'` refusing, plus require an explicit `ALLOW_E2E_AUTH=1`.
- **L13 — `verification_tokens` RLS not explicitly audited.** `supabase/migrations/0001_auth.sql`. Service-role-only by adapter convention; verify Supabase project hasn't auto-granted `anon SELECT`.
- **L14 — `tags` insert in `app/api/posts/route.ts:131` writes new pending tags without `name` set.** `tags.name` is `NOT NULL` in `0002_content.sql:91`. Likely a latent functional bug — first-time tag creation should 500. Worth confirming.

---

## Out-of-scope observations (worth surfacing)

- **No `DELETE /api/users/me` endpoint exists.** Only `PATCH` is exported (`app/api/users/me/route.ts:32`). Self-serve account deletion / GDPR right-to-erasure is unshipped. Pre-launch consideration: are you happy launching without it?
- **Banned authors' posts/profile remain publicly readable.** Ban only blocks login. If a doxxer is banned, their posts and profile remain world-visible until a mod hand-soft-deletes each one. Likely intentional but worth confirming with the product spec.
- **`@vercel/og` not installed.** `package.json` has no `@vercel/og`. Audit prompt is stale, or OG generation uses `next/og`. Verify which renders OG images and what its CVE posture is.
- **`mermaid@^11.15.0` direct dep.** Out of dep-audit scope; renders untrusted markdown → SVG client-side. `securityLevel: 'strict'` is in place — good. Re-audit if you ever switch to `'loose'` for HTML labels.
- **`KIT_API_KEY` not in develop.** Lives on a feature branch — re-audit when the waitlist branch lands.

---

## pnpm audit summary

```
$ rtk proxy pnpm audit --json
$ rtk proxy pnpm audit --prod --json
```

| Severity | Full | Prod-only |
|---|---|---|
| critical | 0 | 0 |
| high     | 0 | 0 |
| moderate | 2 | 2 |
| low      | 0 | 0 |
| info     | 0 | 0 |
| Deps audited | 859 | 415 |

Both moderates:
- `CVE-2026-41305` — `postcss@8.4.31` (transitive via `next`) — XSS via unescaped `</style>`. Not reachable today (no user-supplied CSS). Cleared by `pnpm.overrides: { "postcss@<8.5.10": ">=8.5.10" }`.
- `CVE-2026-41907` — `uuid@8.3.2` (transitive via `next-auth`) — `v3/v5/v6` buffer-overflow. Not reachable (`next-auth` calls `v4()`). Defer to next-auth v5 migration.

No HIGH/CRITICAL CVEs. No supply-chain red flags in root `package.json` (no install/postinstall/prepare scripts). No secret values committed in git history across `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_CLIENT_SECRET`, `KIT_API_KEY`, `NEXTAUTH_SECRET`, `UPSTASH_REDIS_REST_TOKEN`. `.env.local` correctly gitignored; only `.env.example` (empty placeholders) tracked. No server env vars detected in client-component bundle paths.

---

## Live header captures (`dev.agentlab.in`)

```
$ curl -sI https://dev.agentlab.in/
HTTP/2 200
cache-control: private, no-cache, no-store, max-age=0, must-revalidate
strict-transport-security: max-age=63072000
x-powered-by: Next.js
x-vercel-cache: MISS
# (no CSP, no X-Content-Type-Options, no Referrer-Policy, no Permissions-Policy, no X-Frame-Options)

$ curl -sI https://dev.agentlab.in/api/health
HTTP/2 200
cache-control: public, max-age=0, must-revalidate
strict-transport-security: max-age=63072000

$ curl -s https://dev.agentlab.in/api/health
{"ok":true,"db":"ok"}

$ curl -sI https://dev.agentlab.in/admin
HTTP/2 404           # requireAdmin → notFound() — good misdirection,
                     #   undone by robots.txt (H8)

$ curl -sI -H "Origin: https://evil.com" https://dev.agentlab.in/api/health
HTTP/2 200           # no Access-Control-Allow-* echoed — safe

$ curl -s https://dev.agentlab.in/robots.txt
User-Agent: *
Allow: /
Disallow: /admin
Disallow: /write
Disallow: /settings
Disallow: /api
Disallow: /auth/blocked
Disallow: /auth/signin
Host: https://agentlab.in
Sitemap: https://agentlab.in/sitemap.xml

$ curl -s https://dev.agentlab.in/api/auth/providers
{"github":{...,"callbackUrl":"https://dev.agentlab.in/api/auth/callback/github"}}
# Confirms full OAuth flow live on dev — C5
```

---

## Recommended launch-blocker checklist

In merge order, smallest blast radius first:

1. **H8** — trim `robots.txt` to `Disallow: /api/`.
2. **C4** — ship security headers in `next.config.ts` (start CSP in Report-Only).
3. **H7** — add a real `middleware.ts` enforcing origin on all `/api/*` mutating verbs.
4. **C3** — tighten avatar URL validation; restore `next/image` for avatars.
5. **H1** — tighten cover URL validation (use `new URL`, reject `..`).
6. **H4** — add `mdx_preview` rate-limit bucket.
7. **H3 / H15** — add IP RL on `/api/posts/[id]/view`, UUID validate, 204 on all paths.
8. **H9** — Mermaid block length cap + `maxEdges`.
9. **H11** — `/api/uploads` size check before `formData()`.
10. **H10** — sanitize bio server-side.
11. **C6** — transactional ban + session-invalidator trigger + per-request `banned_at` check.
12. **C1 / C7** — RLS rewrites: `users_public` view + revoke base; gate `pinned_posts` and `comments` on parent `deleted_at`.
13. **C2** — auth-gate `banned_reason` rendering on `/auth/blocked`.
14. **C5** — decide between separate Supabase project for preview or env-gated admin in non-prod. This may be the most operationally expensive — start the conversation now.
15. **H6** — wrap Upstash call in try/catch + circuit breaker.
16. **H2** — strip PostgREST metachars from `/api/tags/search` `q`.
17. **H5** — cap wikilink anchors + batch + timeout.
18. **H12** — store `sanitize_version`, schedule re-sanitize sweep.
19. **H13** — `.limit(500)` on CommentsSection + paginate.

H14 + the entire M and L tier can ship in a post-launch hardening sprint.

---

## Files inventoried (read-only)

Auth/session: `lib/auth.ts`, `lib/admin.ts`, `lib/route-guard.ts`, `lib/security/origin-check.ts`, `app/api/auth/[...nextauth]/route.ts`, `app/auth/blocked/page.tsx`.
API routes: every file under `app/api/**`.
MDX/sanitize: `lib/mdx/sanitize.ts`, `lib/mdx/compile.ts`, `lib/mdx/components.tsx`, `lib/mdx/oembed.ts`, `lib/mdx/wikilinks.ts`, `lib/mdx/MermaidBlock.tsx`, `lib/posts/render.ts`, `lib/posts/lookup.ts`, `lib/posts/schema.ts`, `lib/comments/sanitize.ts`, `lib/search/snippet.tsx`, `lib/search/run.ts`, `lib/search/query.ts`, `components/posts/PostBodyStatic.tsx`.
Uploads/images: `lib/uploads/process.ts`, `lib/uploads/validate.ts`, `app/api/uploads/route.ts`, `lib/posts/cover-image.ts`.
DB: every file in `supabase/migrations/` — `0001_auth.sql` through `0012_signup_flags.sql`.
Infra: `next.config.ts`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `app/robots.ts`, `app/sitemap.ts`, `app/api/health/route.ts`, `lib/site-url.ts`, `lib/logging/error-log.ts`.

---

*Audit produced by 7 parallel sub-agents + lead synthesis. No code modified; no tests run; no requests to production written. Live probes limited to `HEAD`/`GET` on dev.agentlab.in public routes. This document is the deliverable — implementation of fixes is out of scope.*
