# agentlab.in CLI + Public API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan phase-by-phase. Each phase below is a single implementer worker's PR scope.

**Goal:** Ship an official `agentlab` CLI and a documented Bearer-auth public REST API so power-users (and agents) can publish, edit, delete posts and comments from the terminal — without leaving the existing session-auth surface in an inconsistent state.

**Architecture:** Personal Access Tokens (PATs) are a second authentication channel that resolves into the same session shape (`{ user: { id, username } }`) every existing route handler already consumes. A thin `resolveAuth()` helper sits in front of `getSession()` and falls back to a token lookup; everything downstream stays unchanged. The CLI is a small TypeScript program in this monorepo (`cli/`) shipped via npm + a Homebrew tap + a `curl | sh` installer that streams from a Next route at `agentlab.in/install.sh`.

**Tech Stack:** Same Next 16 / pnpm / TypeScript / Zod / Supabase / Vitest stack as the web app. CLI uses `commander` for arg parsing, `node:crypto` for hashing, no native deps in v1. Distribution: GitHub Actions for release, `npm publish` for the package, `bump-formula-pr` for the brew tap.

**Tracking:** Issue #26. This plan refines and supersedes the rough sketch in that issue.

**Status:** PLAN (no code yet). Pre-launch: Issue #26 was labeled `future`; the user is moving it to pre-launch and pausing the v1 launch flip until this lands.

---

## Table of contents

1. [Out of scope](#out-of-scope)
2. [Open product calls](#open-product-calls) — operator decisions before phase A starts
3. [Design — Personal Access Tokens](#design--personal-access-tokens)
4. [Design — Public REST API](#design--public-rest-api)
5. [Design — CLI](#design--cli)
6. [Design — Distribution](#design--distribution)
7. [Phase A — PAT plumbing + `/settings/tokens` + browser-based CLI auth bridge](#phase-a--pat-plumbing--settingstokens--browser-based-cli-auth-bridge)
8. [Phase B — Public API hardening + docs](#phase-b--public-api-hardening--docs)
9. [Phase C — CLI shell + core commands](#phase-c--cli-shell--core-commands)
10. [Phase D — Distribution (npm + brew + curl-pipe)](#phase-d--distribution-npm--brew--curl-pipe)
11. [Phase E — Polish (keychain, `--json`, completions)](#phase-e--polish-keychain---json-completions)
12. [Cross-phase test matrix](#cross-phase-test-matrix)
13. [Post-Phase-E — Claude Code skills (non-blocking)](#post-phase-e--claude-code-skills-non-blocking)
14. [Rollout + flag plan](#rollout--flag-plan)

---

## Out of scope

These are explicitly NOT v1 of the CLI/API and must not be smuggled into any phase:

- Server-side webhooks (event delivery to third parties) — post-v1.
- Programmatic OAuth app flow (third-party clients acting on behalf of a user) — post-v1.
- A typed SDK for any language other than the in-tree CLI — post-v1.
- GraphQL or RPC surface — REST only.
- Public read endpoints (`GET /api/posts`, listing, search) — the web app uses RSC + Supabase reads, not REST. We expose them in a later phase when a tool actually needs them.
- Token-scoped rate-limit overrides (e.g. a "pro" tier) — same buckets as session.
- IP allow-lists or per-token network restrictions — overkill for v1.
- Audit log surface for token usage — `last_used_at` only.
- `agentlab post init` scaffolding — see Open Product Call #5.

---

## Open product calls

Operator (Harshit) must decide each of these before the corresponding phase starts. Each has a recommended default; if the operator does not respond by the time the phase runs, the implementer uses the default.

### Top 3 (highest leverage — call out in PR body)

**OPC-1. Token expiry policy.** ✅ **DECIDED (2026-06-03): (a) Never expire; rely on revocation only.**
Considered:
- (a) Never expire; rely on revocation only.
- (b) Hard cap of 1 year, force regeneration.
- (c) User picks expiry per token (`30d`, `90d`, `1y`, `never`).
Trade-off captured: (a) matches what tools-built-against-the-API actually want (set-and-forget). (b) creates a yearly chore. (c) is flexible-but-fiddly.
**Implication for schema:** no `expires_at` column. `/settings/tokens` UI has no expiry picker.

**OPC-2. CLI version signaling at first release.** ✅ **DECIDED (2026-06-03): (a) Ship as `v0.1.0`.**
Considered:
- (a) Ship as `v0.1.0`. Signals "unstable, breaking changes possible."
- (b) Ship as `v1.0.0`. Signals stability and forces semver discipline.
Trade-off captured: (a) gives wiggle-room during first weeks of real use; (b) locks the surface for the marketing win.
**Follow-up locked in:** the CLI is distributed via `brew install` and `npm i -g` (already covered in Phase D). Claude Code skills wrapping the CLI (e.g. a `/agentlab` skill that runs `agentlab post create` on the current buffer) ship after Phase E as a separate non-blocking workstream — tracked as **Post-Phase-E work** at the end of this doc.

**OPC-3. API docs at launch vs. post-launch.** ✅ **DECIDED (2026-06-03): (a) Ship `/docs/api` IN phase B.**
Considered:
- (a) Static MDX page at `/docs/api` shipped IN phase B, before the CLI.
- (b) Defer docs by one phase; rely on the CLI itself to be the "docs" until a follow-up PR.
Trade-off captured: (a) is correct — anyone not using the CLI needs the spec. (b) saves ~half a phase. The MDX doc is small (~400 lines).

### Smaller calls

**OPC-4. Free-tier rate limits.** ✅ **DECIDED (2026-06-03): same buckets as session.**
PAT requests hit the **same** rate-limit buckets as session requests, keyed by `user:<user_id>`. Reason: a token IS the user. Trade-off: a script accidentally looping `agentlab post create` hits the publish limit (10/hr) like a logged-in user clicking publish in a loop would.

**OPC-5. `agentlab post init` scaffolder.** ⏳ **PENDING (operator question on 2026-06-03).**

*Definition (in response to PR review):* `agentlab post init [name] [--type=playbook|post|dive]` would create a new local file `<name>.md` (defaulting to a slug of `<name>` plus `.md`) pre-populated with the YAML frontmatter block for the chosen type, plus a comment skeleton of the required structured sections for that type. For example:

```bash
$ agentlab post init trust-gate --type playbook
✓ Created trust-gate.md
```

```markdown
---
title: # Trust Gate
type: playbook
summary: # one-sentence summary, 60–280 chars
tags:
  -
---

## Environment / Target

(required for playbook — what runtime / model / harness this applies to)

## Prerequisites

(required for playbook — what the reader must have set up first)

## Core Instructions

(required for playbook — the actual steps)

## Safety / Failure Modes

(required for playbook — what goes wrong, what to do)
```

The author then fills in the placeholders and runs `agentlab post create trust-gate.md`. For `--type post`, the section skeleton is omitted (`post` has no required sections per `app/api/posts/route.ts:REQUIRED_SECTION_KEYS`). For `--type dive`, the required keys are `tldr` + `the_question` — the skeleton mirrors that.

**Recommended default (if no decision):** skip in v0.1.0 — `git init` doesn't scaffold either, frontmatter is documented, and skipping saves ~1 day of phase C work (parser + skeletons + tests for each type). The author can copy the frontmatter from the docs page.

**Trade-off if shipped:** ~120 LoC and ~80 LoC tests in phase C; small but non-zero. The first-post experience is friendlier — no copying frontmatter from docs.

**OPC-6. Cover image upload in `post create`.** ✅ **DECIDED (2026-06-03): skip in v0.1.0 of CLI.**
Covers go through `/api/uploads` which we still harden in Phase B for `uploads:write`, but the CLI does not exercise that path in v0.1.0. Authors who want a cover publish via the web UI. Trade-off accepted: terminal-only authors lose a feature in v0.1.0.

**OPC-7. Token-prefix for secret-scanning.** ✅ **DECIDED (2026-06-03): `agl_` prefix.**
`agl_` followed by 43 base64url characters. GitHub secret scanning supports prefixed tokens; a stable 4-char prefix lets us register the format and have GitHub flag accidental commits. Locking this in means the string is forever — secret-scanning enrollment goes ahead with `agl_` (Phase D runbook).

**OPC-8. Endpoints exposed to Bearer auth.** ✅ **DECIDED (2026-06-03): all mutating routes + admin via scope.**
ALL existing mutating routes accept Bearer (posts, comments, likes, bookmarks, follows, reports, pinned-posts). Admin endpoints (`/api/admin/*`) ALSO accept Bearer but only when the token has the `admin:write` scope, which is never granted by default and is hidden from the `/settings/tokens` UI for non-admins. Scope-gated symmetry is cleaner than per-endpoint allow-lists. Trade-off accepted: admins can technically issue a token that has `admin:write` and accidentally lose it — bounded because the same admin already has session access.

**OPC-9. Repo location.** ✅ **DECIDED (2026-06-03): same monorepo, `cli/` subdir.**
Shared types (the API request/response shapes the CLI consumes are already typed in `lib/posts/schema.ts`, `lib/comments/schema.ts`, etc. as Zod schemas) wouldn't rot in a monorepo. CI also stays simple. Trade-off accepted: every `pnpm install` in the web repo also installs CLI deps, mitigated by pnpm workspaces.

**OPC-10. Token storage default.** ✅ **DECIDED (2026-06-03): flat file at `~/.config/agentlab/credentials` with `chmod 600`.**
Keychain (`keytar`) is a **post-Phase-E** improvement, not a default. `keytar` is a native module that breaks cross-compilation, fails on headless Linux CI without `libsecret`, and adds an install step that confuses new users. `chmod 600` is what GitHub CLI defaulted to until 2019 and what 90% of agent harnesses still do. Trade-off accepted: a compromised home directory leaks the token; revocation is the mitigation.

---

## Design — Personal Access Tokens

### Token format

```
agl_<43 chars of base64url>
```

- Total length: 47 chars.
- Entropy: 32 random bytes (256 bits) from `crypto.randomBytes(32)`, base64url-encoded → 43 chars (no padding).
- Prefix `agl_` (lowercase). Constant — used by secret-scanning systems and as a sanity check before doing a DB lookup.
- Display rule: shown to the user **once**, on the page that created it. After navigation away the full token is unrecoverable; only the hash remains in the DB.

### Hashing strategy

**Use SHA-256, NOT bcrypt.** Justification:

- PATs are NOT user-chosen passwords. They have 256 bits of entropy, drawn from a CSPRNG. The attack model for password hashing (slow down brute force against a low-entropy human secret) does not apply.
- GitHub, Stripe, Sentry, Vercel, Linear, Supabase all use SHA-256 (or similar fast hashes) for API tokens. Bcrypt would add 50-200ms to every API request — every check is on the read path.
- Hash format: lowercase hex (64 chars). Column type: `text`. No salt — for a 256-bit secret a salt buys nothing and makes lookups expensive (a salted hash can't be the lookup key).

### Schema — migration `0013_personal_access_tokens.sql`

The next available migration number is **0013** (current head is `0012_signup_flags.sql`). Verify against `supabase/migrations/` before writing.

```sql
CREATE TABLE public.personal_access_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  token_hash    text NOT NULL UNIQUE,   -- sha256 hex
  token_prefix  text NOT NULL,           -- first 8 chars of `agl_<...>` for UI hint
  scopes        text[] NOT NULL DEFAULT '{}',
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  CONSTRAINT pat_scopes_non_empty CHECK (cardinality(scopes) > 0)
);

CREATE INDEX pat_user_id_idx
  ON public.personal_access_tokens (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX pat_token_hash_idx
  ON public.personal_access_tokens (token_hash);

-- RLS: owner-only read (UI calls this with session, not service-role);
-- writes are service-role-only via API routes.
ALTER TABLE public.personal_access_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY pat_owner_select
  ON public.personal_access_tokens
  FOR SELECT
  USING (user_id = auth.uid());
```

**Schema notes:**
- No `expires_at` column unless OPC-1 lands on (b) or (c). The CHECK constraint `pat_scopes_non_empty` keeps the schema honest — a token with zero scopes can do nothing useful and is almost certainly a bug.
- `token_prefix` (the first 8 chars, e.g. `agl_xR2k`) is shown in the token list UI so a user with three tokens can tell them apart. Showing prefix is safe because the remaining 39 chars are still 234 bits of entropy.
- `ON DELETE CASCADE` from `users.id` because if a user is fully deleted their tokens should die too. Bans (Phase 12) do NOT delete the user, so banned users keep their tokens — but `resolveAuth` rejects any token whose owner is banned (see middleware below).

### `lib/auth/pat.ts` (new file)

Single source of truth for token operations. Exposes:

```typescript
export interface NewPatResult {
  fullToken: string  // 'agl_<...>'  — show ONCE
  id: string
  prefix: string     // first 8 chars
}

export function generatePat(): NewPatResult
export function hashPat(fullToken: string): string  // sha256 hex
export function isPatShape(s: string): boolean      // /^agl_[A-Za-z0-9_-]{43}$/
```

The shape check runs BEFORE the DB lookup so malformed input is rejected without a query.

### `lib/auth.ts` — `resolveAuth()`

Add this helper alongside `getSession()`. Existing handlers replace `getSession()` with `resolveAuth()` and consume the returned `AuthContext` instead of `Session`:

```typescript
export type AuthContext =
  | { kind: 'session'; userId: string; username: string; isAdmin: boolean }
  | { kind: 'pat';     userId: string; username: string; isAdmin: boolean;
                       tokenId: string; scopes: string[] }

export async function resolveAuth(req: Request): Promise<AuthContext | null> {
  // 1. Bearer token wins if present and well-formed
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim()
    if (isPatShape(token)) {
      const ctx = await resolvePat(token)
      if (ctx) return ctx
      return null  // malformed-but-shape-valid bearer → 401, NEVER fall through to cookie
    }
    return null
  }
  // 2. Fall back to NextAuth session cookie
  const session = await getSession()
  if (!session?.user?.id || !session.user.username) return null
  return {
    kind: 'session',
    userId: session.user.id,
    username: session.user.username,
    isAdmin: await resolveIsAdmin(session.user.id),
  }
}
```

**Invariants:**
- A bearer header in the request means the caller is API-mode. Never silently fall back to the cookie when the bearer is malformed; that would let a client get cookie auth when they thought they were getting token auth, and `kind` would be wrong downstream.
- `kind: 'session'` always has `scopes: undefined`; helpers like `requireScope` treat session as "all scopes granted." Sessions are full-power; tokens are scoped subsets.
- `username` is populated unconditionally — banned users are rejected at `resolvePat()` so a returned context is always usable.

### `lib/auth/scopes.ts` (new file)

```typescript
export const ALL_SCOPES = [
  'posts:write',      // POST /api/posts, PATCH /api/posts/[id]
  'posts:delete',     // DELETE /api/posts/[id]
  'comments:write',   // POST /api/comments, PATCH /api/comments/[id]
  'comments:delete',  // DELETE /api/comments/[id]
  'engagement:write', // likes, bookmarks, follows
  'reports:write',    // POST /api/reports
  'pins:write',       // pinned-posts add/remove
  'uploads:write',    // POST /api/uploads — hidden from UI in v1 (see OPC-6)
  'admin:write',      // /api/admin/* — hidden from non-admins in UI
] as const

export type Scope = typeof ALL_SCOPES[number]

export const DEFAULT_SCOPES: Scope[] = ['posts:write']

export function requireScope(ctx: AuthContext, scope: Scope): boolean {
  if (ctx.kind === 'session') return true
  return ctx.scopes.includes(scope)
}
```

The handler pattern (used throughout phase B):

```typescript
const ctx = await resolveAuth(req)
if (!ctx) return json(401, { error: 'unauthorized' })
if (!requireScope(ctx, 'posts:write')) return json(403, { error: 'insufficient_scope' })
```

### `resolvePat(token)` flow

1. `isPatShape(token)` — early return null if not shape-valid (no DB hit).
2. `hashPat(token)` → look up `personal_access_tokens` by `token_hash`.
3. Reject (null) if: row not found, `revoked_at IS NOT NULL`, or owning user has `banned_at IS NOT NULL`. **Reject with the same null** in all three cases — never differentiate, never leak why.
4. Read `users.username, users.banned_at, users.id` in the same JOIN-ed query (one round-trip).
5. Fire-and-forget the `last_used_at` debounced update (see below). Do not await.
6. Compute `isAdmin` from `users.github_login`.
7. Return the context.

### `last_used_at` debounce

A naive `UPDATE personal_access_tokens SET last_used_at = now()` on every request would write on every single API call — a noisy hot row.

Strategy: in-process LRU cache keyed by `token_hash`, value `last_persisted_at: number`. Update DB at most once per 60 seconds per token.

```typescript
// lib/auth/pat-last-used.ts
const DEBOUNCE_MS = 60_000
const cache = new Map<string, number>()  // tokenHash → ms epoch of last write

export function markUsed(tokenHash: string, supabase: SupabaseClient): void {
  const now = Date.now()
  const prev = cache.get(tokenHash) ?? 0
  if (now - prev < DEBOUNCE_MS) return
  cache.set(tokenHash, now)
  void supabase
    .from('personal_access_tokens')
    .update({ last_used_at: new Date(now).toISOString() })
    .eq('token_hash', tokenHash)
    .then(({ error }) => {
      if (error) console.warn('[pat] last_used_at update failed', error.message)
    })
}
```

- Single-region Vercel: the cache is per Node instance (lambda warm). A cold start writes on first use, which is correct behavior — eventual write within 60s is the contract.
- The cache is unbounded in theory but bounded in practice by active token count, which is `~= active CLI users`. If this becomes a problem we move to Redis via the same Upstash client already in `lib/rate-limit.ts`.

### Rate limit integration

`guardMutatingRequest` already keys by `user:<userId>`. PAT requests pass the same `userId` so PAT and session usage share buckets. No change required in `lib/route-guard.ts`.

**However:** the origin check inside `guardMutatingRequest` DOES need to change. CLI requests do NOT send an `Origin` header (or send one we won't recognize). The fix:

```typescript
// lib/route-guard.ts — extended GuardOptions
export interface GuardOptions {
  bucket?: RateLimitBucket
  userId?: string | null
  skipOrigin?: boolean
  authKind?: 'session' | 'pat'   // NEW
}

// In guardMutatingRequest:
const enforceOrigin = !opts.skipOrigin && opts.authKind !== 'pat'
if (enforceOrigin) {
  /* existing origin allowlist check */
}
```

Rationale: the Origin allowlist is a CSRF defence, and CSRF is a browser threat. A Bearer token request is not subject to CSRF (a malicious page cannot make the user's browser attach a token it doesn't have). Skipping the check for `kind: 'pat'` is the canonical industry answer (see GitHub API, Stripe API).

### `/settings/tokens` page

New route: `app/settings/tokens/page.tsx` (server component) + `app/settings/tokens/TokensClient.tsx` (client component for the create/revoke interactions).

UI surface:

```
┌───────────────────────────────────────────────────────────────┐
│ Personal Access Tokens                                        │
│ Use these to publish via the agentlab CLI or any HTTP client. │
│                                                               │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ [+ Generate new token]                                    │ │
│ └───────────────────────────────────────────────────────────┘ │
│                                                               │
│ Active tokens                                                 │
│                                                               │
│  Name           Prefix       Scopes                Last used  │
│  ──────────────────────────────────────────────────────────── │
│  laptop         agl_xR2k…    posts:write           3m ago     │
│                                                       [Revoke]│
│  ci-bot         agl_9pLm…    posts:write           never      │
│                                                       [Revoke]│
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Create dialog:
1. Text field: `Token name` (required, 1–100 chars).
2. Checkbox list of scopes (default: only `posts:write` checked).
3. Submit → POST `/api/users/me/tokens` → returns `{ id, prefix, full_token }`.
4. Confirmation panel shows the full token in a copy-button + monospace box with the warning "Copy this now — you will not be able to see it again." User must click "I've saved it" before the panel closes.

Revoke:
- One-click confirm modal ("Revoke 'laptop'? Any CLI using this token will get 401.")
- DELETE `/api/users/me/tokens/{id}` → soft-delete (`revoked_at = now()`).

### New API routes for token management

| Method | Path                          | Purpose                          | Auth        |
| ------ | ----------------------------- | -------------------------------- | ----------- |
| POST   | `/api/users/me/tokens`        | Create a token                   | session ONLY |
| GET    | `/api/users/me/tokens`        | List own tokens (no secret)      | session ONLY |
| DELETE | `/api/users/me/tokens/[id]`   | Revoke a token                   | session ONLY |

**These routes do NOT accept Bearer auth.** Token management is meta — using a token to create or revoke another token is an obvious privilege-escalation tar pit. Stripe, GitHub, and Linear all match this stance.

The GET response shape:

```json
{
  "tokens": [
    {
      "id": "uuid",
      "name": "laptop",
      "prefix": "agl_xR2k",
      "scopes": ["posts:write"],
      "last_used_at": "2026-06-03T12:00:00Z",
      "created_at": "2026-05-01T08:00:00Z"
    }
  ]
}
```

The full token is NEVER returned by GET — only by the POST that created it.

---

## Design — Public REST API

### Versioning

**Keep existing `/api/*` paths.** Do not introduce `/api/v1/*`.

Rationale:
- The web app is the dominant consumer and its fetch sites already point at `/api/posts`. Moving them is risk for no benefit.
- Bumping to `/api/v2` later is a clean break the day we need it. Until then, `v1` is implicit.
- Document this stance in the API docs page so external consumers don't ask. Add an `X-API-Version: 1` response header to every public endpoint as a tripwire — when we bump, the header bumps too, and tooling can pin against it.

### CORS

Bearer-auth requests MUST be cross-origin. The CLI runs on user laptops, agent harnesses run on arbitrary hosts. The exact policy:

```
Request:
  has 'Authorization: Bearer <pat>' header
  → response headers:
      Access-Control-Allow-Origin: *
      Access-Control-Allow-Credentials: false       (cannot be 'true' with *)
      Access-Control-Allow-Headers: authorization, content-type, x-e2e-auth
      Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS

Request:
  has cookie session, no Authorization header
  → response headers:
      Access-Control-Allow-Origin: <origin if in allowlist, else omit>
      Access-Control-Allow-Credentials: true
```

These two policies are mutually exclusive (the `*` + `credentials: true` combination is forbidden by the CORS spec). Implementation: a helper `applyCors(res: Response, ctx: AuthContext | null, origin: string | null)` runs at the end of every route handler.

OPTIONS preflight: a single shared `app/api/_middleware.ts` (Next 16 middleware) or a per-route OPTIONS handler. Recommendation: per-route OPTIONS via a tiny export — Next middleware is hot-path and changing it is a much bigger blast radius.

### Endpoints — Bearer support matrix

| Route                                   | Method     | Scope            | Origin check |
| --------------------------------------- | ---------- | ---------------- | ------------ |
| `/api/posts`                            | POST       | `posts:write`    | skip-on-pat  |
| `/api/posts/[id]`                       | PATCH      | `posts:write`    | skip-on-pat  |
| `/api/posts/[id]`                       | DELETE     | `posts:delete`   | skip-on-pat  |
| `/api/posts/[id]/view`                  | POST       | (none — public)  | skip-on-pat  |
| `/api/comments`                         | POST       | `comments:write` | skip-on-pat  |
| `/api/comments/[id]`                    | PATCH      | `comments:write` | skip-on-pat  |
| `/api/comments/[id]`                    | DELETE     | `comments:delete`| skip-on-pat  |
| `/api/likes/[postId]`                   | POST       | `engagement:write` | skip-on-pat |
| `/api/bookmarks/[postId]`               | POST       | `engagement:write` | skip-on-pat |
| `/api/follows/[userId]`                 | POST       | `engagement:write` | skip-on-pat |
| `/api/pinned-posts`, `[postId]`         | POST/DEL   | `pins:write`     | skip-on-pat  |
| `/api/reports`                          | POST       | `reports:write`  | skip-on-pat  |
| `/api/uploads`                          | POST       | `uploads:write`  | skip-on-pat  |
| `/api/tags/search`                      | GET        | (none — public)  | n/a (GET)    |
| `/api/users/me`                         | GET        | (none — auth-id) | n/a (GET)    |
| `/api/users/me/tokens` (all)            | all        | SESSION ONLY     | enforced     |
| `/api/admin/*` (all)                    | all        | `admin:write`    | skip-on-pat  |
| `/api/auth/[...nextauth]/*`             | all        | SESSION ONLY     | enforced     |
| `/api/health`                           | GET        | none             | n/a          |
| `/api/mdx/preview`                      | POST       | session ONLY (editor preview helper; not part of public API) | enforced |

Three routes intentionally stay session-only: token management (privilege escalation), NextAuth (browser-only), and `/api/mdx/preview` (editor draft helper — not part of the published surface).

### Error response shape

All routes already return `{ "error": "<machine_code>", "detail"?: string, "issues"?: [...] }`. Keep that. Add an `X-Request-Id` response header on 5xx + 401 + 403 so support can correlate.

Standardize these error codes (current code is consistent enough that this is a documentation change, not a refactor):

| Code                  | HTTP | Meaning                                          |
| --------------------- | ---- | ------------------------------------------------ |
| `unauthorized`        | 401  | No or invalid auth                               |
| `insufficient_scope`  | 403  | Authenticated but token lacks the required scope |
| `forbidden`           | 403  | Authenticated but not the resource owner / admin |
| `forbidden_origin`    | 403  | Cookie request from disallowed origin            |
| `not_found`           | 404  | Resource missing or soft-deleted                 |
| `invalid_json`        | 400  | Body was not valid JSON                          |
| `invalid_body`        | 400  | Body failed Zod parse                            |
| `rate_limited`        | 429  | Bucket exhausted; `Retry-After` header set       |

### Docs surface — `/docs/api`

Live at `app/(marketing)/docs/api/page.tsx` (server component reading static MDX from `docs/api/`). Single page, table of contents at top. Sections:

1. **Authentication** — how to mint a PAT at `/settings/tokens`, the `agl_` prefix, the Bearer header.
2. **Rate limits** — bucket table copied from `lib/rate-limit.ts`.
3. **Errors** — table from previous section.
4. **Posts** — POST, PATCH, DELETE with example curl + response.
5. **Comments** — POST, PATCH, DELETE.
6. **Engagement** — likes / bookmarks / follows.
7. **Uploads** — POST with multipart.
8. **Tokens** — read-only reference of `/api/users/me/tokens` (mentioning it's session-only).
9. **Changelog** — empty at v1.0, populated on every breaking-or-additive change.

OpenAPI / generated docs are **out of scope for v1**. The Zod schemas have everything we'd need, but the tooling (zod-to-openapi) adds a build step. Defer.

---

## Design — CLI

### Language and runtime

**TypeScript transpiled to plain ESM JavaScript, distributed as an npm package with a Node shebang.**

- No compiled binaries in v1. `bun build --compile` and `pkg` both work but each adds 60+ MB to release artifacts and ~10 min of CI. We get them in v1.1.
- Minimum Node version: 20 LTS (active LTS as of 2026-06). Validated at `bin/agentlab.js` via a top-of-file version check.
- Shebang: `#!/usr/bin/env node`.

**Why not Bun-only or Deno-only?** Most agent harnesses run on Node, not Bun. Forcing a Bun install for a CLI is a barrier; Node is everywhere.

### Library choice — arg parsing

**Use `commander` (v12+).** Reasons:
- Stable, no ecosystem churn, well-typed, ~30 KB install.
- `oclif` is more featureful (plugins, autocomplete bake-in) but is overkill for ~7 commands and pulls in ~5 MB of deps.
- `yargs` is fine but `commander`'s help formatter is nicer for our taste.

### Repo location

**Same monorepo, `cli/` subdir, pnpm workspace.** Per OPC-9 above.

Workspace config — `pnpm-workspace.yaml` at repo root:

```yaml
packages:
  - .
  - cli
```

`cli/package.json` is its own package (`name: "agentlab"`, `bin: { agentlab: "./dist/agentlab.js" }`). The web app does NOT depend on the CLI package — they share types via direct path imports into `lib/posts/schema.ts` for v1, then we extract shared types into a `shared/` package in v1.1 if it grows.

### Command surface (v1.0)

```
agentlab login                          Opens https://agentlab.in/cli/auth?... in
                                        the browser; user clicks Authorize; CLI
                                        receives the token via local loopback.
                                        See "agentlab login flow" below.
agentlab login --device                 Headless / SSH fallback: prints a short
                                        user code; user enters it at
                                        https://agentlab.in/cli/auth/device.
agentlab login --token <agl_...>        Non-interactive: caller supplies a token
                                        directly (CI use case).
agentlab logout                         Deletes the stored credential file.
agentlab whoami                         Prints @<username>. Exit 1 if not logged in.

agentlab post create <file.md>          Reads file, parses frontmatter, POSTs to
                                        /api/posts. Prints the resulting URL.
agentlab post list [--mine|--all]       Lists posts. --mine (default) shows own
                                        posts; --all shows global heat feed.
                                        Columns: SLUG, TYPE, TITLE, PUBLISHED.
agentlab post edit <slug-or-url>        Fetches body_md, opens $EDITOR, PATCHes
                                        on save. No-ops on empty save.
agentlab post delete <slug-or-url>      Confirms (y/N) then DELETEs.

agentlab comment <post-url> <body>      Posts a top-level comment.

agentlab --version                      Prints version from package.json.
agentlab --help                         Prints help.
```

**Subcommands deferred to v1.1+** (do NOT add to v1):
- `agentlab post init` — see OPC-5.
- `agentlab like <url>`, `agentlab bookmark <url>`, `agentlab follow @user` — `engagement:write` scope already exists, the commands are tiny. Could add to v1 if PR scope allows; default is to defer to keep phase C's surface bounded.
- `agentlab report <url> <reason>` — moderation surface, low priority.
- `agentlab profile edit` — out of scope.
- Tab completion via `agentlab completion zsh|bash|fish` — phase E.
- `--json` output on every command — phase E.

### Markdown frontmatter format

YAML frontmatter, parsed with `js-yaml` (or `yaml@2`, same install size, the implementer picks).

```markdown
---
title: Trust Gate Pattern
type: playbook          # one of: post | playbook | dive
summary: A pattern for gating LLM tool calls behind verifiable guardrails.
tags:                   # 1–5 tags, lowercase, kebab-case
  - security
  - prompting
  - multi-agent
cover: ./cover.png      # OPTIONAL. v1: rejected with a "covers not supported via CLI" error.
---

# Body starts here

Markdown body follows the frontmatter delimiter.
```

Required fields: `title`, `type`, `summary`, `tags`. `cover` is parsed but rejected with a clear error in v1 (see OPC-6).

Field-level validation lives in `cli/src/frontmatter.ts`. It MUST mirror the server-side Zod schema (`lib/posts/schema.ts` → `PostCreateBody`) — write a unit test (`cli/tests/frontmatter.test.ts`) that imports the server Zod schema and asserts the CLI parser's output passes it. This catches drift.

### Token storage

Default: `~/.config/agentlab/credentials` (XDG-ish on macOS too; we don't bother with Apple-style paths in v1).

```
$ cat ~/.config/agentlab/credentials
{
  "host": "https://agentlab.in",
  "token": "agl_<...>",
  "username": "harshitsinghbhandari",
  "created_at": "2026-06-03T12:00:00Z"
}
$ stat -f %Lp ~/.config/agentlab/credentials
600
```

On creation: `fs.mkdir(dir, { recursive: true, mode: 0o700 })` then `fs.writeFile(path, json, { mode: 0o600 })`. On Windows: use `os.homedir() + '/AppData/Roaming/agentlab/credentials'`, NO chmod (Windows ACLs are different; document that the user folder is per-account so the file is per-account by default).

Override env vars:
- `AGENTLAB_TOKEN` — read from env if set, used instead of the file. Useful for CI.
- `AGENTLAB_HOST` — used instead of `https://agentlab.in`. Useful for `dev.agentlab.in` testing.
- `AGENTLAB_CONFIG` — alternative path to the credentials file. Lower priority than `AGENTLAB_TOKEN`.

Precedence: `AGENTLAB_TOKEN` > `AGENTLAB_CONFIG` file > default file.

Keychain integration via `keytar`: see Phase E.

### `agentlab login` flow — browser-based (loopback OAuth-style)

Per operator decision on 2026-06-03 (review comment on OPC-1's thread), the primary login flow is **browser-based**, not paste-a-token. The user runs `agentlab login`, the CLI opens a URL, the user clicks "Authorize" in the browser, and the CLI receives the token automatically — no manual copy-paste.

The "paste a token" flow stays as a documented fallback for CI / headless environments (`--token <agl_...>` flag or `AGENTLAB_TOKEN` env var, both already specified above).

**Happy-path UX:**

```
$ agentlab login
Opening https://agentlab.in/cli/auth?request_id=8f1c... in your browser...
Waiting for you to authorize... (timeout in 5 minutes)

(browser: user signs in with GitHub if not already, then sees an
 "Authorize the agentlab CLI to publish, comment, and react on
 your behalf?" page with the device name pre-filled as "MacBook Pro of
 harshitsinghbhandari". User clicks Authorize.)

✓ Logged in as @harshitsinghbhandari
  Credential saved to /Users/harshit/.config/agentlab/credentials
```

**Headless / SSH fallback (device-code style):**

```
$ ssh remote-box
$ agentlab login --device
To authorize this CLI:
  1. On any computer, visit https://agentlab.in/cli/auth/device
  2. Enter the code: AGL-XR2K-9PLM
Waiting for you to authorize... (timeout in 10 minutes)

✓ Logged in as @harshitsinghbhandari
```

**Mechanics — loopback flow (default):**

1. CLI binds a random free port on `127.0.0.1` (Node `net.createServer().listen(0)`).
2. CLI generates a `request_id` (UUID v4) and a `pkce_verifier` (32 random bytes → base64url). Stores both in memory.
3. CLI computes `pkce_challenge = base64url(sha256(pkce_verifier))`.
4. CLI POSTs to `/api/cli/auth/start` with `{ request_id, pkce_challenge, redirect_uri: "http://127.0.0.1:<port>/cb", client_name: <os.hostname()>, scopes: DEFAULT_SCOPES }`. Server stores the row in `cli_auth_requests` (new table, see below) and responds `{ authorize_url: "https://agentlab.in/cli/auth?request_id=..." }`.
5. CLI opens the URL via the `open` npm package. If no DISPLAY (headless), CLI prints the URL and tells the user to visit it manually. (Server-driven device-code is the cleaner headless mode — see `--device` flag below.)
6. User signs in with GitHub if needed, lands on `app/cli/auth/page.tsx`. The page reads `request_id` from the query, fetches the request details (`client_name`, `scopes`), shows a single "Authorize" button + "Cancel" button.
7. On "Authorize", browser POSTs to `/api/cli/auth/authorize` with `{ request_id }`. Server (session-authenticated): looks up the request, mints a fresh PAT (named `<client_name>` e.g. `MacBook Pro of harshitsinghbhandari`, scopes from the request), updates `cli_auth_requests.authorized_at` and stores the *encrypted* full token tied to the request, then redirects the browser to `<redirect_uri>?request_id=<id>`. (Token is NOT in the redirect URL — only `request_id`. The CLI exchanges it next.)
8. CLI's local HTTP server receives the GET `/cb?request_id=<id>`. CLI POSTs to `/api/cli/auth/exchange` with `{ request_id, pkce_verifier }`. Server: checks the `pkce_verifier` hashes to the stored `pkce_challenge`, marks the request as `exchanged_at`, returns the full token. PKCE prevents an attacker who saw the redirect URL from claiming the token without the verifier.
9. CLI's local HTTP server responds to the browser with a tiny HTML page: "You can close this window — the CLI is now signed in." Local server shuts down. CLI saves the credential (token + username) and prints success.

**Mechanics — device-code flow (`--device` flag, headless):**

1. CLI POSTs to `/api/cli/auth/device/start` with `{ client_name, scopes }`. Server creates a `cli_auth_requests` row, generates a short user-facing code (e.g. `AGL-XR2K-9PLM` — 8 chars + dashes, ~40 bits of entropy because the lookup window is brief) and a long `device_code` (32 bytes base64url, opaque, used by the CLI to poll). Responds `{ user_code, device_code, verification_url, expires_in: 600, poll_interval: 5 }`.
2. CLI prints `verification_url` + `user_code`, then polls `POST /api/cli/auth/device/poll` with `{ device_code }` every 5s.
3. User visits `https://agentlab.in/cli/auth/device` (signs in with GitHub if needed), enters the code, sees the same "Authorize" page as the loopback flow with the same client_name + scopes, clicks Authorize.
4. Server marks the request authorized and mints the PAT.
5. CLI's next poll returns the full token. CLI saves the credential and prints success.

**Why PKCE (loopback flow)?** A malicious process on the same machine can bind a different port and intercept the redirect URL. PKCE means even if an attacker sees the redirect, they can't claim the token without `pkce_verifier`, which never leaves the original CLI process. Belt-and-suspenders for a low-probability local-process-MITM threat, but it's table stakes for any OAuth-shaped flow today.

**Why a one-time exchange (rather than redirecting the full token to localhost)?** A URL with the full token in the redirect could land in shell history, browser history, or a referrer header. The exchange step keeps the token out of any URL.

**Why a custom flow rather than reusing NextAuth?** NextAuth provides the GitHub session that backs `/api/cli/auth/authorize`. The CLI flow itself is bespoke — adding NextAuth as an OAuth *provider* (server-side) would mean implementing a full OAuth2 server (clients table, scopes, refresh tokens, etc.) which is massively out of scope for v0.1.0. The bespoke flow above is ~200 LoC server-side and gives us the right UX with the same security properties.

**New table — `cli_auth_requests`** (added to Phase A schema):

```sql
CREATE TABLE public.cli_auth_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL UNIQUE,        -- supplied by CLI (loopback) or generated (device)
  flow            text NOT NULL CHECK (flow IN ('loopback', 'device')),
  pkce_challenge  text,                          -- loopback flow only; null for device
  redirect_uri    text,                          -- loopback flow only; null for device
  user_code       text UNIQUE,                   -- device flow only; null for loopback
  device_code_hash text UNIQUE,                  -- device flow only; sha256 hex; null for loopback
  client_name     text NOT NULL,                 -- displayed to user; becomes PAT name on authorize
  scopes          text[] NOT NULL,
  authorized_by   uuid REFERENCES public.users (id) ON DELETE CASCADE,
  authorized_at   timestamptz,
  exchanged_at    timestamptz,                   -- loopback only — when CLI exchanged for token
  token_id        uuid REFERENCES public.personal_access_tokens (id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL,          -- request itself expires (5m loopback, 10m device)
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cli_flow_consistent CHECK (
    (flow = 'loopback' AND pkce_challenge IS NOT NULL AND redirect_uri IS NOT NULL
                       AND user_code IS NULL AND device_code_hash IS NULL)
    OR
    (flow = 'device'   AND user_code IS NOT NULL AND device_code_hash IS NOT NULL
                       AND pkce_challenge IS NULL AND redirect_uri IS NULL)
  )
);

CREATE INDEX cli_auth_requests_request_id_idx ON public.cli_auth_requests (request_id);
CREATE INDEX cli_auth_requests_user_code_idx  ON public.cli_auth_requests (user_code)
  WHERE user_code IS NOT NULL AND authorized_at IS NULL;
CREATE INDEX cli_auth_requests_expires_at_idx ON public.cli_auth_requests (expires_at);

-- RLS: service-role only (route handlers do all the work).
ALTER TABLE public.cli_auth_requests ENABLE ROW LEVEL SECURITY;
-- No SELECT policy → no rows visible to non-service-role; all access via API.
```

Rows are short-lived — a periodic cleanup job (Vercel cron, daily) deletes anything where `expires_at < now() - interval '1 day'`. We don't want abandoned auth requests piling up forever. (Phase D adds the cron.)

**New API routes** (added to Phase A):

| Method | Path                                | Purpose                                         | Auth          |
| ------ | ----------------------------------- | ----------------------------------------------- | ------------- |
| POST   | `/api/cli/auth/start`               | CLI starts loopback flow                        | none          |
| POST   | `/api/cli/auth/exchange`            | CLI exchanges verifier for token                | none          |
| POST   | `/api/cli/auth/device/start`        | CLI starts device flow                          | none          |
| POST   | `/api/cli/auth/device/poll`         | CLI polls for completion                        | none          |
| POST   | `/api/cli/auth/authorize`           | Browser confirms authorization (both flows)     | session ONLY  |
| GET    | `/api/cli/auth/request/[request_id]`| Browser fetches client_name + scopes to display | session ONLY  |

`/api/cli/auth/start` is unauthenticated — anyone with network access can create a pending request. Mitigation: rate-limit at `5/min/IP` (new bucket `cli_auth_start`), and the request is useless without a user logging in via the bridge page anyway. `/api/cli/auth/exchange` is unauthenticated but requires the PKCE verifier — a brute-force is bounded by the 256-bit verifier entropy.

**New bridge page** (added to Phase A):

- `app/cli/auth/page.tsx` — loopback flow's authorize screen (reads `request_id` from query).
- `app/cli/auth/device/page.tsx` — device flow's "enter your code" screen.
- Both screens render in the existing app shell, require session, and show a clear "Authorize the agentlab CLI named **<client_name>** to act on your behalf with the following scopes: …" prompt.
- Both screens show a "Cancel" button that POSTs a cancel + redirects to `/`.

**Effect on Phase A size:** adds ~600 LoC (table + 6 routes + 2 pages + tests). Phase A bumps from L to L+ but remains a single PR. The `/settings/tokens` UI (manual token creation) is unchanged — both surfaces coexist.

**Effect on Phase C size:** the CLI login command grows by ~200 LoC (local HTTP server, PKCE helpers, device-code polling). Still L.

**Open question — automatically scope the browser-created token?** Recommended: the bridge mints a token with the `DEFAULT_SCOPES` (`['posts:write']`) only. Users who want more scopes use `/settings/tokens` directly. This keeps the consent screen short and the security story simple. If we let `agentlab login` request arbitrary scopes via the start request, a hostile `npm i -g agentlab-typosquat` could trick users into authorizing `admin:write`. The fixed-default-scope answer eliminates that whole class.

### `agentlab post create` flow

1. Read file. Reject if missing or not `.md`.
2. Parse frontmatter. Validate required fields. Reject with the exact missing/invalid field name.
3. If `cover` field is set, reject with `"covers are not yet supported via the CLI — publish via the web editor."` (until OPC-6 changes).
4. POST `/api/posts` with `{ type, title, summary, tags, body_md }`.
5. Print:
   ```
   ✓ Published: https://agentlab.in/@harshitsinghbhandari/playbook/trust-gate-pattern
   ```
6. On 4xx, print the server error message and exit 1 with the HTTP status. On 5xx, print "server error (try again)" and exit 1.

### Output conventions

- Default: human-friendly with ANSI colors (when `process.stdout.isTTY === true`).
- `--json` flag (phase E): all output is a single JSON object per command, no color, no spinners. For `post create`: `{ "id": "...", "slug": "...", "url": "..." }`.
- Errors (default mode): single line `agentlab: <message>` to stderr, exit code mirrors HTTP status (e.g. 4 for 4xx, 5 for 5xx, 1 for client errors).
- No spinners in v1 (one less dep). `console.log("...")` plus stderr writes suffice.

### Logging / diagnostics

- `AGENTLAB_DEBUG=1` (env): logs every HTTP request + response body to stderr. No logging by default — we don't want a CLI invocation to leave a trail in the user's shell history.

---

## Design — Distribution

Three channels, one source artifact: the npm tarball.

### npm

- Package name: **`agentlab`** (verify unclaimed at https://www.npmjs.com/package/agentlab before phase D; if taken, fall back to `agentlab-cli`).
- Published from `cli/` workspace via `pnpm --filter agentlab publish`.
- Published as plain JS (no native deps, no platform-specific binary in v1).
- `npm i -g agentlab` → `agentlab` is on PATH.
- npm dist-tag: `latest` for stable, `next` for pre-release (used during the canary).

### Homebrew

- Tap repo: `harshitsinghbhandari/homebrew-tap` (create empty, push the Formula). User-facing install: `brew tap harshitsinghbhandari/tap && brew install agentlab`.
- Formula points at the GitHub release tarball (the same npm tarball, by URL), checks SHA256, runs `npm install -g .` inside the cellar to wire the bin. This avoids needing Bun/pkg for v1.
- Auto-bump: the release workflow uses `mislav/bump-homebrew-formula-action` to open a PR against the tap on every tag.

### curl-pipe — `https://agentlab.in/install.sh`

- Route: `app/install.sh/route.ts` returns `text/plain` shell script (NOT a static file in `public/` — the route lets us version the script and add headers like `Cache-Control: public, max-age=300`).
- Script behavior:
  ```sh
  set -euo pipefail
  # detect OS+arch
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$(uname -m)" in
    x86_64|amd64) ARCH=x64 ;;
    arm64|aarch64) ARCH=arm64 ;;
    *) echo "unsupported arch" >&2; exit 1 ;;
  esac
  # check that node >= 20 is available
  node -v | awk -F. '{ exit ($1 == "v20" || $1 == "v21" || $1 == "v22") ? 0 : 1 }' \
    || { echo "node v20+ is required" >&2; exit 1; }
  # install latest from npm into a temp prefix, drop a symlink in /usr/local/bin or ~/.local/bin
  npm install -g agentlab@latest
  echo "agentlab installed at $(command -v agentlab)"
  ```
- Why a Next route, not a static file? Two reasons: (1) we can add `Cache-Control` and bump the script under one URL, (2) we can change the script logic without re-deploying the static assets pipeline.
- This script is **identical** for all three channels' fallback — if npm is missing, we point the user at brew. We do NOT compile binaries in v1, so no GitHub-release-binary download.

When phase E (or v1.1) adds compiled binaries, the script switches to downloading platform-specific binaries from GitHub releases. The interface (`curl -fsSL https://agentlab.in/install.sh | sh`) is stable.

### Release workflow — `.github/workflows/cli-release.yml`

Triggers on tag matching `cli-v*` (e.g. `cli-v0.1.0`). Single job:

```yaml
on:
  push:
    tags: ['cli-v*']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write        # for GitHub release creation
      id-token: write        # for npm provenance
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v5
        with: { version: 9 }
      - uses: actions/setup-node@v5
        with: { node-version: '20', registry-url: 'https://registry.npmjs.org' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter agentlab run build
      - run: pnpm --filter agentlab run test
      - run: pnpm --filter agentlab publish --access public --provenance --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: cli/dist/**
      - uses: mislav/bump-homebrew-formula-action@v3
        with:
          formula-name: agentlab
          homebrew-tap: harshitsinghbhandari/homebrew-tap
          download-url: https://registry.npmjs.org/agentlab/-/agentlab-${{ env.VERSION }}.tgz
        env:
          COMMITTER_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
```

The web-app `.github/workflows/ci.yml` is unchanged — CLI tests run in a separate workflow.

Secrets to add to repo settings (operator must do this manually before phase D):
- `NPM_TOKEN` — automation token from npm with publish-only scope.
- `HOMEBREW_TAP_TOKEN` — fine-grained GitHub PAT with `contents: write` on the tap repo only.

---

## Phase A — PAT plumbing + `/settings/tokens` + browser-based CLI auth bridge

**Goal:** Land PAT auth as a parallel channel to the session cookie, AND land the browser-based CLI authorization bridge (loopback + device-code flows) that Phase C's `agentlab login` will consume. By end of phase A:
- An engineer with a `agl_` token can `curl -H 'Authorization: Bearer agl_...' https://agentlab.in/api/users/me` and get a 200 with their profile.
- The web UI at `/settings/tokens` lets users create and revoke tokens manually.
- The web UI at `/cli/auth?request_id=...` (loopback) and `/cli/auth/device` (device-code) lets a signed-in user authorize a pending CLI request, minting a fresh PAT and returning it to the requesting CLI via the redirect/poll mechanisms specified in "Design — CLI → `agentlab login` flow."

**Estimated PR size:** **L+** (~2100 LoC including the CLI auth bridge — bigger than Phase 12 moderation but still a single PR; the bridge endpoints and the PAT plumbing share the `lib/auth/*` helpers so splitting would duplicate setup).

**Depends on:** all v1 phases (1–14) shipped. Existing.

**Files (rough):**
- Create: `supabase/migrations/0013_personal_access_tokens.sql` (PAT table + cli_auth_requests table — both in one migration; same review surface, both are PAT-related).
- Create: `lib/auth/pat.ts` (generate, hash, shape check)
- Create: `lib/auth/scopes.ts` (scope const, `requireScope`)
- Create: `lib/auth/resolve.ts` (`resolveAuth`, `resolvePat`)
- Create: `lib/auth/pat-last-used.ts` (debounce + write helper)
- Create: `lib/auth/cli-auth.ts` (request lifecycle: create, fetch-for-display, authorize, exchange, poll, expire — pure functions + DB helpers)
- Create: `lib/auth/pkce.ts` (verify a PKCE verifier against a stored challenge; `generateUserCode` for device flow)
- Modify: `lib/auth.ts` (re-export `resolveAuth`; do NOT delete `getSession`)
- Modify: `lib/route-guard.ts` (add `authKind` option, skip origin when `pat`)
- Modify: `lib/rate-limit.ts` (add buckets: `cli_auth_start` 5/min, `cli_auth_exchange` 10/min, `cli_auth_device_poll` 60/min — last is per-device_code to absorb the 5s polling cadence with headroom)
- Create: `app/api/users/me/tokens/route.ts` (GET, POST)
- Create: `app/api/users/me/tokens/[id]/route.ts` (DELETE)
- Create: `app/api/cli/auth/start/route.ts` (POST — loopback start, no auth)
- Create: `app/api/cli/auth/exchange/route.ts` (POST — loopback exchange, no auth, PKCE-verified)
- Create: `app/api/cli/auth/device/start/route.ts` (POST — device-code start, no auth)
- Create: `app/api/cli/auth/device/poll/route.ts` (POST — device-code poll, no auth)
- Create: `app/api/cli/auth/authorize/route.ts` (POST — session-required confirm)
- Create: `app/api/cli/auth/request/[request_id]/route.ts` (GET — session-required, returns `client_name + scopes` for the bridge page UI)
- Create: `app/settings/tokens/page.tsx`
- Create: `app/settings/tokens/TokensClient.tsx`
- Create: `app/cli/auth/page.tsx` (loopback bridge UI)
- Create: `app/cli/auth/device/page.tsx` (device-code entry UI)
- Create: `app/cli/auth/AuthorizeClient.tsx` (shared "Authorize/Cancel" client component used by both pages)
- Modify: `app/api/users/me/route.ts` — accept Bearer (single-route prototype to validate the wiring; broad rollout is phase B)
- Create: `tests/unit/auth-pat.test.ts`
- Create: `tests/unit/auth-resolve.test.ts`
- Create: `tests/unit/auth-scopes.test.ts`
- Create: `tests/unit/cli-auth.test.ts` (request lifecycle, PKCE verify, user-code generation, expiry)
- Create: `tests/integration/cli-auth-loopback.test.ts` (full loopback flow against seeded Supabase)
- Create: `tests/integration/cli-auth-device.test.ts` (device-code flow with polling)
- Create: `tests/e2e/settings-tokens.spec.ts`
- Create: `tests/e2e/cli-auth-bridge.spec.ts` (Playwright: sign in, hit /cli/auth?request_id=..., click Authorize, verify the API exchange returns a working token)
- Modify: `lib/env.ts` — no new env vars expected, but verify.

**API/schema changes:**
- New migration 0013: `personal_access_tokens` + `cli_auth_requests` tables, RLS, indexes, the cross-flow CHECK constraint.
- New session-only routes for token CRUD.
- New routes for CLI auth bridge (some unauthenticated by design — the start/exchange/poll endpoints — protected by PKCE + rate limits).
- `/api/users/me` becomes the first Bearer-accepting endpoint.
- Augment `Session.user` types if needed (`username` is already required by phase 6 — verify in `next-auth.d.ts`).

**Tests required:**
- Unit: `generatePat()` produces a token matching `/^agl_[A-Za-z0-9_-]{43}$/` and a hash that round-trips through `hashPat`.
- Unit: `isPatShape` rejects empty, malformed prefix, wrong length, and an old bcrypt-style hash.
- Unit: `resolveAuth` returns `{kind: 'pat'}` for a valid token, null for a revoked one, null for a banned user, null when the header is malformed-but-not-shape-valid (NEVER session fallback).
- Unit: `markUsed` debounces — calling it twice within a second writes once.
- Unit: `requireScope` returns true for `kind: 'session'` regardless of scope.
- Integration (Vitest with seeded Supabase): POST `/api/users/me/tokens` returns full token once; GET hides it; DELETE marks revoked.
- E2E (Playwright): user navigates to `/settings/tokens`, generates a token, sees the one-time display, copies it, refreshes — token no longer shown in plaintext; revokes via the row action; row disappears.

**Tasks (ordered):**

*PAT plumbing*

1. **Write migration 0013** with the `personal_access_tokens` schema AND the `cli_auth_requests` schema (both from the design sections above). Include `pat_user_id_idx` (partial, active only), `pat_token_hash_idx`, the three `cli_auth_requests_*` indexes, and the cross-flow CHECK constraint. Add RLS policies (PAT owner-select; cli_auth_requests service-role-only). Run locally via `pnpm supabase db push`.
2. **`lib/auth/scopes.ts`** with the const + `requireScope` helper. Unit test the helper.
3. **`lib/auth/pat.ts`** — `generatePat`, `hashPat`, `isPatShape`. Unit test each.
4. **`lib/auth/resolve.ts`** — `resolveAuth`, `resolvePat`. Unit test via a Supabase mock. Key cases: revoked, banned, malformed, valid. (OPC-1 is decided as "never expire" so no expiry branch is needed.)
5. **`lib/auth/pat-last-used.ts`** — debounce module + LRU. Unit test the debounce behavior with a fake clock.
6. **Modify `lib/route-guard.ts`** — add `authKind` option, conditional origin enforcement. Update existing call sites: only `app/api/users/me/route.ts` in this phase, the rest are phase B.
7. **Modify `app/api/users/me/route.ts`** — swap `getSession()` for `resolveAuth(req)`. Add Bearer support + CORS headers. Unit test the route with a token, a session, and no auth.
8. **`app/api/users/me/tokens/route.ts`** — GET (list) and POST (create). Session-only. Generate via `generatePat`, persist hash + prefix, return the full token in the POST response. Tests.
9. **`app/api/users/me/tokens/[id]/route.ts`** — DELETE (revoke). Session-only. Verify ownership via `user_id = ctx.userId`. Soft-delete by setting `revoked_at`. Tests.
10. **`app/settings/tokens/page.tsx`** — server component that lists active tokens (read via Supabase directly, not by fetching our own API). Includes the create button (delegates to client component).
11. **`app/settings/tokens/TokensClient.tsx`** — client component with create dialog (name input + scope checkboxes), one-time display, revoke confirmation. Plays nicely with light/dark theme (see how Phase 12 admin pages do this).
12. **Surface the link in `/settings`** — add a "Tokens" subnav entry next to "Profile". Modify `app/settings/page.tsx` if needed.
13. **E2E test** for the full create-then-revoke flow.

*CLI auth bridge — loopback flow*

14. **`lib/auth/pkce.ts`** — `verifyPkce(verifier, storedChallenge): boolean` (constant-time compare of `sha256(verifier)` against the stored challenge). Unit test happy + tampered.
15. **`lib/auth/cli-auth.ts`** — request lifecycle helpers: `createLoopbackRequest`, `getRequestForDisplay`, `authorizeRequest`, `exchangeForToken`. Pure-ish (take a Supabase client); each is unit-tested via a mock.
16. **`lib/rate-limit.ts`** — add the three new buckets (`cli_auth_start`, `cli_auth_exchange`, `cli_auth_device_poll`). Verify Upstash + memory fallback both serve the new buckets.
17. **`app/api/cli/auth/start/route.ts`** — POST: validate input (request_id UUID, pkce_challenge base64url, redirect_uri matches `http://127.0.0.1:<port>/cb` shape, client_name 1–100 chars, scopes subset of `DEFAULT_SCOPES`). Rate-limit by IP. Insert row. Return `{ authorize_url }`. Tests.
18. **`app/api/cli/auth/request/[request_id]/route.ts`** — GET, session-required. Returns `{ client_name, scopes, expires_at }` for the bridge page. 404 if request expired or not found. Tests.
19. **`app/api/cli/auth/authorize/route.ts`** — POST, session-required. Validates the session user can authorize; mints PAT via `generatePat`; updates `cli_auth_requests` with `authorized_by, authorized_at, token_id`; returns `{ redirect_uri }` (which the bridge page then navigates to). Tests.
20. **`app/api/cli/auth/exchange/route.ts`** — POST: validate `request_id` + `pkce_verifier`; check `authorized_at IS NOT NULL`, `exchanged_at IS NULL`, `expires_at > now()`. On success: mark exchanged, return `{ token, username }`. The PAT row is keyed; we look up its hash → return the full token by re-reading? **Implementation note:** because we never store the full token, we must produce it at authorize time and stash it in memory or in a short-lived column. Simplest: a `token_plaintext_encrypted` column on `cli_auth_requests` holding the token symmetrically encrypted with an env key (`CLI_AUTH_TOKEN_KEY`, 32 bytes hex). On exchange we decrypt + return + null the column. This keeps the plaintext out of the long-lived `personal_access_tokens` table. Tests.
21. **`app/cli/auth/page.tsx`** + **`app/cli/auth/AuthorizeClient.tsx`** — bridge page that reads `?request_id=...`, fetches request details, renders the "Authorize" consent screen with scopes listed, calls authorize endpoint on click, then `window.location.replace(redirect_uri)`.

*CLI auth bridge — device-code flow*

22. **`lib/auth/cli-auth.ts` (extend)** — `createDeviceRequest`, `findRequestByUserCode`, `findRequestByDeviceCode`. `generateUserCode` returns `AGL-XXXX-XXXX` from 8 random base32 chars.
23. **`app/api/cli/auth/device/start/route.ts`** — POST: validate input; insert row; return `{ user_code, device_code, verification_url, expires_in: 600, poll_interval: 5 }`. Rate-limit by IP. Tests.
24. **`app/api/cli/auth/device/poll/route.ts`** — POST: input `{ device_code }`. Returns `{ status: 'pending'|'authorized', token?, username? }`. Rate-limit per-device_code. Tests.
25. **`app/cli/auth/device/page.tsx`** — input box for the code, then same `AuthorizeClient` component once the code resolves to a request.

*Cross-cutting*

26. **Integration test** — full loopback flow via supertest-style harness (POST start, fake browser GET request, POST authorize with a session cookie, POST exchange, verify token works against `/api/users/me`).
27. **Integration test** — full device flow with polling.
28. **E2E `tests/e2e/cli-auth-bridge.spec.ts`** — Playwright signs in, navigates to a `/cli/auth?request_id=...` URL prepared by a test fixture, clicks Authorize, asserts the API exchange returns a working token.
29. **Manual smoke** — run dev server, generate a token via the UI AND via a curl-driven simulation of the loopback flow, hit `/api/users/me` with both tokens.

**Acceptance:**
- Migration applies cleanly to a fresh Supabase project; both new tables exist with the right constraints + indexes.
- Vitest + Playwright all green.
- `curl` with a valid Bearer to `/api/users/me` returns 200; with a revoked token returns 401; with no token returns 401.
- The settings page renders correctly in light + dark mode.
- The token is shown ONCE on creation in the settings UI and can never be re-read.
- A simulated loopback flow (curl scripted against the new routes) round-trips: start → authorize-via-session → exchange → returns a token usable on `/api/users/me`.
- A simulated device flow: start → enter user_code in a browser-authorized session → poll returns the token.
- `cli_auth_requests` rows expire (a request older than `expires_at` returns 410 Gone or similar on every endpoint that reads it).

---

## Phase B — Public API hardening + docs

**Goal:** Every public-API-shaped endpoint accepts Bearer auth, enforces the right scope, returns correct CORS headers, and is documented at `/docs/api`.

**Estimated PR size:** **M-L** (~1000 LoC, mostly mechanical route swaps + one doc page).

**Depends on:** Phase A.

**Files (rough):**
- Modify all mutating API routes listed in the support matrix above. Each route:
  - Replaces `getSession()` with `resolveAuth(req)`.
  - Adds the `requireScope(ctx, '<scope>')` check.
  - Passes `authKind: ctx.kind` to `guardMutatingRequest`.
  - Adds CORS headers via the `applyCors` helper.
  - Implements an OPTIONS handler.
- Create: `lib/security/cors.ts` — `applyCors(res, ctx, origin)` helper.
- Create: `lib/security/preflight.ts` — `handlePreflight(req)` returning a 204 Response for OPTIONS; called from each route's OPTIONS export.
- Modify: `lib/route-guard.ts` — already done in phase A, but verify call sites pass `authKind`.
- Create: `docs/api/index.mdx` — single-page docs.
- Create: `app/(marketing)/docs/api/page.tsx` — server component rendering the MDX.
- Modify: `app/(marketing)/layout.tsx` (or wherever the marketing nav lives) — add "API docs" link.
- Modify: `next-auth.d.ts` — ensure `Session.user.username` is non-optional (already done in Phase 6, double-check).
- Create: `tests/unit/cors.test.ts`
- Create: `tests/e2e/public-api.spec.ts` — end-to-end with a real token: create post, edit, delete.
- Modify each `tests/integration/api-*.test.ts` to add Bearer cases alongside session cases.

**API/schema changes:**
- No new tables. No new columns.
- All affected routes now respond with CORS headers. Behavior for cookie-session traffic is unchanged (allowlist applies).
- New `X-API-Version: 1` header on all `/api/*` routes (add via a tiny helper inside `applyCors`).

**Tests required:**
- Unit: `applyCors` sets `Access-Control-Allow-Origin: *` for `kind: 'pat'`, sets the allowlisted origin for `kind: 'session'`, omits the header when neither matches.
- Unit: `handlePreflight` returns 204 with the correct headers; rejects unknown methods.
- Integration: each of the 15+ routes in the support matrix gets two cases per HTTP method (PAT + session). Token has the right scope → success; missing scope → 403 `insufficient_scope`.
- Integration: cross-origin POST with a cookie (no Bearer) is rejected (`forbidden_origin`).
- Integration: cross-origin POST with a Bearer (no Origin header) succeeds.
- E2E: a real token from phase A is used to create a post via `fetch` in Playwright, then PATCH the title, then DELETE. Each step verifies the response shape.

**Tasks (ordered):**

1. **`lib/security/cors.ts`** — `applyCors(res, ctx, origin)`. Unit tests for all three branches (pat / session-allowlisted / unauthenticated-disallowed).
2. **`lib/security/preflight.ts`** — `handlePreflight(req)`. Tests.
3. **Sweep `/api/posts/route.ts`** — replace `getSession()` with `resolveAuth(req)`, add scope check, pass `authKind`, wrap response with CORS, add OPTIONS export. Update its integration test.
4. **Sweep `/api/posts/[id]/route.ts`** for both PATCH and DELETE. Tests.
5. **Sweep `/api/posts/[id]/view/route.ts`** — public route, no scope, but still needs CORS for `kind: 'pat'`.
6. **Sweep `/api/comments/route.ts`** + `/api/comments/[id]/route.ts`. Tests.
7. **Sweep engagement routes** — `/api/likes/[postId]`, `/api/bookmarks/[postId]`, `/api/follows/[userId]`. Tests.
8. **Sweep `/api/pinned-posts/route.ts`** + `/api/pinned-posts/[postId]/route.ts`. Tests.
9. **Sweep `/api/reports/route.ts`**. Tests.
10. **Sweep `/api/uploads/route.ts`** — special-case: multipart, not JSON. Add `uploads:write` scope check. Tests. Verify the in-CLI v1 surface does NOT exercise this (OPC-6 deferral) but the endpoint is still hardened.
11. **Sweep `/api/admin/*` routes** — accept Bearer when `admin:write` scope is present AND `ctx.isAdmin` is true. (Both must hold: scope alone doesn't make you admin, and admin alone doesn't satisfy scope for token requests.) Tests.
12. **Sweep `/api/tags/search/route.ts`** — GET, public, just needs CORS for token callers. Tests.
13. **Write `docs/api/index.mdx`** — full doc page. Include working curl examples for create-post, edit-post, comment.
14. **`app/(marketing)/docs/api/page.tsx`** — renders the MDX. Add the link to the marketing footer/nav.
15. **E2E `tests/e2e/public-api.spec.ts`** — three-step token round-trip.
16. **Manual smoke** — deploy to `dev.agentlab.in`, run the canonical curl examples from the docs page.

**Acceptance:**
- Every route in the support matrix has tests for the PAT + session cases.
- Docs page renders without console errors and the curl examples copy cleanly.
- A cross-origin browser fetch with a valid Bearer succeeds; without one is rejected.
- All v1 phases' existing tests still pass (the swap from `getSession` → `resolveAuth` is non-breaking).

---

## Phase C — CLI shell + core commands

**Goal:** Working `agentlab` binary in the `cli/` workspace. Locally installable via `pnpm --filter agentlab build && (cd cli && pnpm link --global)`. All commands listed in the design section work end-to-end against `dev.agentlab.in`.

**Estimated PR size:** **L** (~1800 LoC including tests, comparable to Phase 3 editor).

**Depends on:** Phase A (PATs minted), Phase B (Bearer accepted everywhere).

**Files (rough):**

```
cli/
├── package.json
├── tsconfig.json
├── eslint.config.mjs        # extends repo root config
├── src/
│   ├── main.ts              # commander setup, command registration
│   ├── version.ts           # exports version from package.json (read at build)
│   ├── config/
│   │   ├── paths.ts         # ~/.config/agentlab paths (XDG-respecting)
│   │   └── credentials.ts   # load/save/clear credential file
│   ├── api/
│   │   ├── client.ts        # fetch wrapper with Bearer header, base URL, errors
│   │   └── errors.ts        # ApiError class
│   ├── commands/
│   │   ├── login.ts
│   │   ├── logout.ts
│   │   ├── whoami.ts
│   │   ├── post-create.ts
│   │   ├── post-list.ts
│   │   ├── post-edit.ts
│   │   ├── post-delete.ts
│   │   └── comment.ts
│   ├── frontmatter.ts       # YAML frontmatter parse + validate
│   ├── editor.ts            # $EDITOR open + tempfile dance
│   └── ui/
│       ├── prompt.ts        # readline prompts (hidden + visible)
│       ├── confirm.ts       # y/N confirm
│       └── format.ts        # color helpers (tty-aware)
├── tests/
│   ├── frontmatter.test.ts
│   ├── credentials.test.ts
│   ├── api-client.test.ts
│   ├── commands/
│   │   ├── login.test.ts
│   │   ├── whoami.test.ts
│   │   └── post-create.test.ts
│   └── fixtures/
│       ├── valid-playbook.md
│       └── missing-tags.md
├── bin/
│   └── agentlab.js          # shebang entry — `import('../dist/main.js').then(m => m.run())`
└── README.md                # `agentlab` package readme (npm-visible)
```

**Files at repo root touched:**
- Create: `pnpm-workspace.yaml`.
- Modify: `package.json` (no change unless adding workspaces — usually not needed).
- Modify: `.github/workflows/ci.yml` — add a job step `pnpm --filter agentlab run test`.
- Modify: `.gitignore` — `cli/dist`, `cli/coverage`.
- Modify: `AGENTS.md` — document the CLI workspace.

**API/schema changes:** none.

**Tests required:**
- Unit: `loadCredentials()` reads file; absent file → returns null. Env-var override is respected.
- Unit: `saveCredentials()` writes mode 0600 (assert via `fs.statSync().mode`).
- Unit: `parseFrontmatter()` parses, validates, rejects unknown `type`, rejects empty tags array. The same parser's output passes the server-side Zod schema.
- Unit: `ApiClient.post()` includes the Authorization header; converts non-2xx to `ApiError` with the parsed body.
- Unit: `commands/login.ts` validates the pasted token shape before hitting `/api/users/me`.
- Unit: `commands/post-create.ts` calls the API client with the parsed body; on success prints the URL.
- Integration: hit `https://dev.agentlab.in` from a CI-environment token (a special "ci" token whose value is in CI secrets) — round-trips a post create + delete.

**Tasks (ordered):**

1. **Create the `cli/` workspace skeleton.** `pnpm init`, `tsconfig.json` (ESM, target ES2022), eslint extending root. `bin/agentlab.js` shebang stub.
2. **Add workspace** — `pnpm-workspace.yaml` at root, `pnpm install` to wire the dep graph.
3. **`cli/src/version.ts`** — reads version from `package.json` at build time (esbuild or tsc can inline; simplest: read at runtime via `import.meta.url + '/../package.json'`).
4. **`cli/src/config/paths.ts`** + **`config/credentials.ts`** — load, save, clear, env-var override. Tests.
5. **`cli/src/api/client.ts`** — fetch wrapper. `client.get(path)`, `client.post(path, body)`, `client.patch(path, body)`, `client.delete(path)`. Reads token + host from `Credentials`. Tests with `undici`'s `MockAgent`.
6. **`cli/src/api/errors.ts`** — `ApiError extends Error` with `.status` and `.body`. Tests.
7. **`cli/src/ui/prompt.ts`** + **`confirm.ts`** + **`format.ts`** — readline-based prompts, hidden mode for token entry. Tests of the prompt fn use a fake `process.stdin`.
8. **`cli/src/commands/login.ts`** — implements the loopback flow specified in "Design — CLI → `agentlab login` flow." Tasks inside this task:
   - **8a.** `cli/src/auth/loopback-server.ts` — binds `127.0.0.1:0`, exposes a Promise that resolves on the first GET `/cb?request_id=...`. Includes a 5-minute hard timeout that closes the server with an error. Tests with a fake browser hitting the bound port.
   - **8b.** `cli/src/auth/pkce.ts` — generates `pkce_verifier` (32 random bytes → base64url) and `pkce_challenge` (`base64url(sha256(verifier))`). Tests.
   - **8c.** `cli/src/auth/loopback.ts` — orchestrates: bind server, POST start, open browser via `open`, wait for callback, POST exchange, return token + username.
   - **8d.** `cli/src/auth/device.ts` — `--device` flag: POST device-start, print user code + verification URL, poll device-poll on the documented interval, return token on success.
   - **8e.** `cli/src/commands/login.ts` — top-level dispatcher: if `--token` flag is set, use that directly; if `--device` flag, run device flow; otherwise run loopback flow with device-flow auto-fallback when `open` fails (no DISPLAY). Save credential on success. Tests for all three branches.
9. **`cli/src/commands/logout.ts`** — delete credential file. Test it doesn't error if absent.
10. **`cli/src/commands/whoami.ts`** — print `@<username>` from cached credential. No HTTP call (we save username at login). Test.
11. **`cli/src/frontmatter.ts`** — `parseFile(path): { meta, body }`. Validate against a Zod schema that mirrors `PostCreateBody` but doesn't import it directly (the web package is a separate workspace; duplicate the rules and assert equivalence in a cross-workspace test). Tests for happy path, missing fields, invalid type, too many tags.
12. **`cli/src/commands/post-create.ts`** — read file, parse, validate, POST, print URL. Tests.
13. **`cli/src/commands/post-list.ts`** — GET a hypothetical `/api/users/me/posts` endpoint OR query the existing public feed filtered by username. **Decision needed at implementation time** (see implementation note below). Tests against the chosen endpoint.
14. **`cli/src/editor.ts`** — open `$EDITOR` on a temp file, return the new content. Tests.
15. **`cli/src/commands/post-edit.ts`** — fetch body_md (need a `GET /api/posts/<slug-or-id>` returning `body_md` for the author — verify what currently exists; if not, add it as a phase-C scope addition that respects `posts:write` scope's read-of-own-post implication). Open editor, PATCH on save. Tests.
16. **`cli/src/commands/post-delete.ts`** — confirm, DELETE. Tests.
17. **`cli/src/commands/comment.ts`** — parse the URL, resolve to a post id (`GET /api/posts/by-url?u=...` — add the route IF it doesn't exist, otherwise parse the URL client-side and use the existing structure), POST comment. Tests.
18. **`cli/src/main.ts`** — commander setup, register commands, error handler. Smoke test that `agentlab --help` prints the expected commands.
19. **CI integration** — `.github/workflows/ci.yml` runs `pnpm --filter agentlab build`, then `pnpm --filter agentlab test`.
20. **`cli/README.md`** — install + usage docs.
21. **Local smoke** — `pnpm --filter agentlab build && (cd cli && pnpm link --global)`, log in against `dev.agentlab.in`, publish a fixture post, edit it, delete it.

**Implementation note (task 13/15/17):**
Three commands need read endpoints that aren't crisply public yet:
- `post list --mine` → need `GET /api/users/me/posts` (does NOT exist; the web app uses Supabase RSC reads). Phase C must add this route — POST-style minimal: lists own posts, accepts Bearer with no extra scope (reading your own posts is an `auth-id` permission).
- `post edit` → fetching body_md for editing. Need `GET /api/posts/[id]` returning the full author-facing body. Phase C adds this; gated by ownership (or admin).
- `comment` → resolve post URL to post id. Cleanest: parse the URL pattern (`/@user/type/slug`) and call a new `GET /api/posts/by-slug?username=...&slug=...` returning `{ id }`. Phase C adds it.

These three additions are scoped under phase C (not B) because they exist for the CLI; the web app does not need them. Document them in `docs/api/index.mdx` as part of phase B's docs page IF phase C lands before docs publish; otherwise update docs in phase E.

**Acceptance:**
- `agentlab --version` prints the expected version.
- `agentlab login` against `dev.agentlab.in` saves a credential with mode 0600.
- `agentlab post create cli/tests/fixtures/valid-playbook.md` returns a 201 + URL.
- `agentlab post edit <slug>` opens `$EDITOR`, modifying the content and saving triggers a PATCH that shows the new content on the post page.
- `agentlab post delete <slug>` removes the post.
- `agentlab comment <url> "hello"` posts a comment that renders on the post page.
- CI runs CLI tests green.

---

## Phase D — Distribution (npm + brew + curl-pipe)

**Goal:** Anyone can install agentlab via `npm i -g agentlab`, `brew install agentlab` (via tap), or `curl -fsSL https://agentlab.in/install.sh | sh`. CI publishes on tag.

**Estimated PR size:** **M** (~700 LoC including workflow + install script + docs; comparable to Phase 14 hardening).

**Depends on:** Phase C (the CLI exists).

**Files (rough):**
- Create: `.github/workflows/cli-release.yml`.
- Create: `app/install.sh/route.ts` — Next route returning `text/plain` shell script.
- Create: `tests/unit/install-script.test.ts` — assert the install script's content matches the published-route response.
- Create: `tests/e2e/install-script-arch-detection.spec.ts` — Playwright running the script through `bash --noprofile --norc -c` with mocked `uname` to verify arch detection.
- Modify: `cli/package.json` — fill in `bin`, `files`, `repository`, `publishConfig`.
- Modify: `app/(marketing)/docs/api/page.tsx` (or a new install page) — add `agentlab` install instructions.
- Create: `harshitsinghbhandari/homebrew-tap` repo (manual one-time setup by operator before phase D runs; document in the phase as "operator step").
- Document: `docs/cli-release-runbook.md` — how to cut a release, what `cli-v*` tag triggers.

**API/schema changes:** none. The install.sh route is a new public surface but doesn't touch DB.

**Tests required:**
- Unit: the install script's shell content includes the canonical OS+arch detection logic. (Snapshot test against a fixture; alerts the implementer when the script changes.)
- Unit: install.sh route returns `text/plain` with `Cache-Control: public, max-age=300`.
- E2E: GitHub Actions workflow validated via `act` locally (operator step) — full path on a fake tag.

**Tasks (ordered):**

1. **Verify `agentlab` is unclaimed on npm.** If taken, fall back to `agentlab-cli` and update `cli/package.json` everywhere.
2. **Operator manual step (out-of-PR):** Create the `homebrew-tap` repo, the `NPM_TOKEN` secret, the `HOMEBREW_TAP_TOKEN` secret. Document them in `docs/cli-release-runbook.md` as part of the PR. (The CI workflow will exist but won't run successfully until secrets are configured.)
3. **Fill in `cli/package.json`** — `version: 0.1.0` (per OPC-2 default), `bin`, `files: ["dist", "bin", "README.md"]`, `engines: { "node": ">=20" }`, `publishConfig: { "access": "public", "provenance": true }`, `repository`.
4. **`.github/workflows/cli-release.yml`** — exactly as in the design section. Runs on `cli-v*` tag push.
5. **`app/install.sh/route.ts`** — returns the shell script. Cache 5 minutes. Unit-test the response. The script is a string constant in the route file (no template engine needed).
6. **`docs/cli-release-runbook.md`** — operator-facing runbook: cutting a tag (`git tag cli-v0.1.0 && git push --tags`), verifying npm publish, verifying tap PR landed.
7. **Update `cli/README.md`** with all three install methods.
8. **Manual smoke** (operator):
   - Cut `cli-v0.1.0-rc.1` tag against the merged branch. Workflow runs; verifies tarball published under the `next` dist-tag.
   - Install via `npm i -g agentlab@next` from a fresh shell. Verify `agentlab --version` prints `0.1.0-rc.1`.
   - Manually open a tap PR (because `bump-formula-pr` on a release-candidate is awkward); confirm `brew install harshitsinghbhandari/tap/agentlab` works.
   - `curl -fsSL https://dev.agentlab.in/install.sh | bash` — installs from npm `latest` (we'd need a real `latest` first; for the canary, ssh to the dev origin and serve the candidate).

**Acceptance:**
- A tag push on `cli-v0.1.0-rc.1` produces an npm release on the `next` dist-tag and a tap PR.
- Installing via npm works on macOS arm64, macOS x64, Linux x64, Linux arm64. Windows is "untested in v1" — document in the README.
- `curl -fsSL https://agentlab.in/install.sh | bash` runs without errors on a fresh macOS box.

---

## Phase E — Polish (keychain, `--json`, completions)

**Goal:** Quality-of-life features that aren't blocking for v1.0 but improve the experience for power-users and scripted use cases.

**Estimated PR size:** **M** (~800 LoC). Can be split into two PRs if scope feels tight.

**Depends on:** Phase D (CLI is in users' hands; we have signal on what hurts).

**Files (rough):**
- Modify: every `cli/src/commands/*.ts` — add `--json` flag handling.
- Create: `cli/src/output.ts` — central output helper that branches on `--json`.
- Create: `cli/src/keychain.ts` — optional keytar integration with file fallback.
- Create: `cli/src/completion/zsh.ts`, `cli/src/completion/bash.ts`, `cli/src/completion/fish.ts` — completion script generators.
- Create: `cli/src/commands/completion.ts` — `agentlab completion <shell>` prints the script to stdout.
- Modify: `cli/package.json` — add `keytar` as an *optional* dependency (will install on Linux/macOS that have libsecret, will fail soft on platforms that don't).
- Create: `cli/tests/keychain.test.ts`, `cli/tests/output.test.ts`, `cli/tests/completion.test.ts`.

**API/schema changes:** none.

**Tests required:**
- Unit: `--json` flag causes every command to write a single JSON object to stdout and nothing to stderr on success.
- Unit: `--json` errors write a JSON error object to stderr.
- Unit: keychain helper uses `keytar` when available, falls back to file when import fails. Spy on both code paths.
- Unit: completion scripts include the command names in the expected positions for each shell.
- Manual: `eval "$(agentlab completion zsh)"`; typing `agentlab po<TAB>` expands.

**Tasks (ordered):**

1. **`cli/src/output.ts`** — central helper. Tests.
2. **Refactor every command** to use `output.success(...)` and `output.error(...)`. Wire `--json` global flag via commander.
3. **`cli/src/keychain.ts`** — optional `keytar` import wrapped in try/catch. Tests.
4. **Migration helper** — first time keychain is enabled, move existing credential from file → keychain, leaving a stub file with a note. Tests.
5. **`cli/src/completion/*.ts`** — completion scripts. Tests.
6. **`cli/src/commands/completion.ts`** + register. Tests.
7. **README updates** — `--json` examples, completion install instructions.
8. **Release `cli-v0.2.0`.**

**Acceptance:**
- `agentlab post list --json` prints valid JSON parseable by `jq`.
- `agentlab post list --json | jq '.[0].slug'` works.
- `agentlab post create file.md --json` returns `{ "id": "...", "slug": "...", "url": "..." }`.
- On a Mac, the credential round-trips through Keychain after migration.
- Completion script works in zsh.

---

## Cross-phase test matrix

A consolidated view of what must be true after each phase. Implementers should be able to look at this and confirm phase boundaries are clean.

| Capability                                    | After A | After B | After C | After D | After E |
| --------------------------------------------- | ------- | ------- | ------- | ------- | ------- |
| `personal_access_tokens` + `cli_auth_requests` tables exist | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/settings/tokens` UI                         | ✅      | ✅      | ✅      | ✅      | ✅      |
| `/cli/auth` (loopback) + `/cli/auth/device` bridge live | ✅ | ✅ | ✅ | ✅ | ✅ |
| `Authorization: Bearer agl_*` works on `/api/users/me` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bearer works on every mutating route          | ❌      | ✅      | ✅      | ✅      | ✅      |
| CORS configured for cross-origin Bearer       | ❌      | ✅      | ✅      | ✅      | ✅      |
| `/docs/api` page live                         | ❌      | ✅      | ✅      | ✅      | ✅      |
| `agentlab` binary in `cli/`                   | ❌      | ❌      | ✅      | ✅      | ✅      |
| `agentlab login/whoami/post/comment` work     | ❌      | ❌      | ✅      | ✅      | ✅      |
| Published to npm                              | ❌      | ❌      | ❌      | ✅      | ✅      |
| `brew install agentlab` works                 | ❌      | ❌      | ❌      | ✅      | ✅      |
| `curl agentlab.in/install.sh | sh` works      | ❌      | ❌      | ❌      | ✅      | ✅      |
| `--json` output flag                          | ❌      | ❌      | ❌      | ❌      | ✅      |
| Keychain (macOS/Linux with libsecret)         | ❌      | ❌      | ❌      | ❌      | ✅      |
| Shell completions                             | ❌      | ❌      | ❌      | ❌      | ✅      |

---

## Post-Phase-E — Claude Code skills (non-blocking)

Per operator decision on 2026-06-03 (review comment on OPC-2's thread), once the CLI is installable, we wrap it with a small set of Claude Code skills so an agent in a user's editor can publish, edit, and comment via natural-language prompts. This is a **separate workstream** that does NOT block CLI v0.1.0 launch — it lands as a follow-up after Phase E.

**Sketch (not the full design):**
- A `skills/agentlab/` directory at the repo root (or a separate `agentlab-skills` repo distributed via plugin marketplace — TBD).
- One skill per top-level command:
  - `publish` — "publish this buffer as an agentlab playbook/post/dive" → wraps `agentlab post create`.
  - `edit-post` — "open my agentlab post titled X for editing" → wraps `agentlab post edit`.
  - `comment` — "post this as a comment on <url>" → wraps `agentlab comment`.
  - `whoami` — "what's my agentlab handle" → wraps `agentlab whoami`.
- Skills invoke the CLI via the user's existing `~/.config/agentlab/credentials` — the same authentication state, no separate login flow inside the skill.
- Skills should fail with a clear "run `agentlab login` first" message if no credential exists.

**Open question (deferred):** ship the skills bundled with the npm package (so `npm i -g agentlab` installs them into the user's `~/.claude/skills/`), or as a separate Claude Code plugin published independently. The latter is the cleaner story (skill distribution and CLI distribution have different cadences); the former is one-step UX. Decide when the workstream picks up.

---

## Rollout + flag plan

**No feature flag.** The PAT plumbing is dormant until a user generates a token; existing users are untouched. The CORS changes are additive (cookie sessions still rejected from disallowed origins, just like today).

**Pre-launch order on agentlab.in:**
1. Phase A merges + deploys to `dev.agentlab.in` first. Smoke test for one day.
2. Phase A merges to prod (agentlab.in). Smoke test for one day.
3. Phase B follows the same dev-then-prod gate.
4. Phase C runs entirely against `dev.agentlab.in` for the CLI's first canary. Once `agentlab` round-trips a post end-to-end on dev, merge.
5. Phase D's first release tag (`cli-v0.1.0-rc.1`) publishes under npm dist-tag `next`. Operator installs, validates. Only when stable does phase D's runbook tag a `cli-v0.1.0` and bump npm `latest` + the brew formula.
6. Phase E ships as `cli-v0.2.0` after one week of real-world `cli-v0.1.x` use.

**v1 launch dependency:** The Phase 15 launch flip is currently paused because the operator wants CLI + API in the launch surface. Phases A + B + C + D must all be on prod before the launch flip. Phase E can land in the first week post-launch.

**Backward compatibility:** none required — this is a new surface. The single risk is the route-handler swap (Phase B), which is mechanical but touches ~17 files. Mitigation: each route is its own commit, and CI tests must stay green between each.

**Database migration risk:** Phase A's migration ADDs two tables (`personal_access_tokens`, `cli_auth_requests`) — no ALTER on hot tables, no backfills, no downtime risk. Routine Supabase `db push`.

**Secret-scanning enrollment:** Once `agl_` is in production, file the GitHub secret-scanning provider registration form (https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partner-program). This is operator-manual, ~30 min one-time. Add to the phase D runbook.

---

## Appendix — references

- Issue #26: rough sketch of CLI scope and 5-phase rollout. This document refines it.
- `docs/v1-plan.md`: the original 16-phase v1 plan (implemented through phase 14 + SEO infra + post-review fixes).
- `lib/auth.ts`: NextAuth setup, `getSession()`, `resolveIsAdmin()`.
- `lib/route-guard.ts`: existing origin allowlist + rate-limit middleware.
- `lib/rate-limit.ts`: Upstash + in-memory fallback. The seven existing buckets are reused for PAT traffic.
- `supabase/migrations/0011_moderation.sql`: schema-convention reference for the new PAT migration (column shapes, RLS style, indexes, CHECK constraints).
- `app/api/posts/route.ts`, `app/api/comments/route.ts`, `app/api/posts/[id]/route.ts`: representative current-API shape; all phase B sweeps follow this pattern.
