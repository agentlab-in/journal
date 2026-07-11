# agentlab.in — Go-Public / Gated-Showcase Conversion Plan

Status: proposal for review. Nothing here is executed. Every claim is cited to a file path or migration number; where a value lives only in a runtime dashboard (Vercel / Supabase / GitHub OAuth) it is called out as an open question, not guessed.

Mission recap: repo goes public; site stays live and readable by everyone; nobody can register or write unless the owner manually approves them out-of-band (email to harshit@agentlab.in, then the applicant replies "I agree to the terms at agentlab.in/terms"). Legal surface collapses to a single `/terms`. Threat model for every control: (a) a hostile reader has the full source, and (b) the running platform is unwatched for weeks. Both hold at once.

---

## 0. The one correction that reshapes the brief

The brief says: "Write access must be enforced in the database via RLS keyed on approval status." **For this codebase that is a category error, and following it literally would produce a control that does nothing.** Verified chain:

- Every write flows through `createAdminSupabaseClient()` (service_role). Example: `app/api/posts/route.ts:133,255`. The migration comment states it outright: "Writes by signed-in users go through API routes that use service_role" (`supabase/migrations/0003_grant_public_to_roles.sql:26-28`).
- `service_role` **bypasses RLS**. anon/authenticated hold `SELECT` only (`0003:28`); there are no INSERT/UPDATE/DELETE grants or policies for them anywhere (confirmed by the security audit's table-by-table matrix).
- No Supabase JWT is ever minted, so real users never assume the `authenticated` role at all. Every browser/server call is Supabase-role `anon`, and `auth.uid()` is always null (`lib/auth.ts:306` uses `session:{strategy:'database'}`; no `setSession`/`jwt.sign` anywhere). Consequence: any RLS policy keyed on `auth.uid()` or approval status is **dead code for real traffic**.

So an "RLS keyed on approval" policy would gate a role (`authenticated`) that no real request uses, against a write path (`service_role`) that bypasses RLS entirely. It would be pure theater.

**The DB-enforced invariant that actually holds** against service_role, and against anyone who steals the service key and hits Postgres directly, is a **`BEFORE INSERT` trigger** (and FK constraints). Triggers and constraints fire regardless of role; only RLS is bypassed. This plan therefore enforces approval with a trigger on every content table, with the app-layer checks (`getSession`, `route-guard`) as the convenience layers the brief intends. This satisfies "prefer database-enforced invariants" correctly for this architecture.

---

## 1. Findings (severity-ranked, verified)

### Critical / High

**F1 (High) — The gated write model does not exist yet.** The only thing between a stranger and full write access is `evaluateGate` (`lib/auth.ts:41-73`): a heuristic (GitHub account age ≥ 30 days, ≥ 1 public repo, non-reserved name, not banned). Any account clearing that bar signs in via `app/api/auth/[...nextauth]/route.ts`, auto-provisions a `public.users` row (`lib/auth.ts:595-703` + trigger from `0002`), and can immediately POST to every write route. `signup_flags` (`0012`) is a soft moderator hint, never a gate. `ADMIN_GITHUB_LOGINS` gates only `/admin`, not `/api/posts`. 30-day GitHub accounts are farmable/purchasable; under threat (b) this is unbounded unmonitored write access. This is the central gap the whole plan closes.

**F2 (High) — Admin pages are authorized only at the layout.** `app/admin/layout.tsx` is the sole gate (`requireAdmin`). The six pages `app/admin/{page,users,reports,tags,orgs,audit}/page.tsx` do no per-request check of their own, yet their RSC bodies run service-role, RLS-bypassing reads (`lib/admin/search-users.ts`, `lib/admin/list-audit.ts`, etc.). `force-dynamic` on the layout means it does execute per request and `notFound()` discards the body, so nothing leaks *today*, but App Router layouts are explicitly not an authorization boundary (they do not re-run on client navigation, and nested handlers/streaming can bypass them). This is a fragile defense-in-depth gap that a public repo makes attractive to probe. Admin *mutation* routes are correctly gated per-request (`requireAdminApi` in all 8 `app/api/admin/**`), which caps severity.

### Medium

**F3 (Medium) — Rate limiting fails open by default, and the config is about to be public.** `FAIL_OPEN = process.env.RATE_LIMIT_FAIL_OPEN !== 'false'` (`lib/rate-limit.ts`), and `guardMutatingRequest` additionally returns `{failed:false}` if the limiter throws (`lib/route-guard.ts:80-85`). If Upstash is unset or times out, throttling silently vanishes; the fallback is per-lambda in-memory, non-authoritative on Vercel. Going public publishes the exact bucket thresholds and the fail-open default, telling an attacker that inducing an Upstash timeout removes the limit. Combined with F1 pre-fix, this is the abuse-amplifier.

**F4 (Medium) — `increment_post_view_count` is an anon-callable write.** `0004` grants EXECUTE to `anon` (kept by `0020`). The route `app/api/posts/[id]/view/route.ts` wraps it in origin + IP rate-limit, but the browser-shipped anon key lets an attacker call `rpc('increment_post_view_count')` directly against PostgREST, skipping every route control, to inflate any post's `view_count`. Vanity-only (view_count is not in the heat formula, `0009`), so impact is counter integrity, not access.

**F5 (Medium) — The owner's admin login is committed in the example env.** `.env.example:29` ships `ADMIN_GITHUB_LOGINS=harshitsinghbhandari`. Public repo + env-only admin mechanism means this names the exact GitHub account to phish for full moderation control.

**F6 (Medium) — `next_auth` PostgREST exposure is safe only by omission.** `README.md:79-81` instructs exposing the `next_auth` schema. It is safe today only because `0001_auth.sql` never grants `USAGE ON SCHEMA next_auth` to anon/authenticated, so anon hits permission-denied before any table (sessions/accounts/tokens are therefore not anon-readable — requirement met). But `0003`'s `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ... TO anon, authenticated` auto-grants anon SELECT on every *future* `public` table, so the safety of both schemas rests on an invariant no test enforces.

### Low

**F7 (Low)** — Origin check is the only CSRF control and is trivially spoofable by a non-browser client (`lib/security/origin-check.ts`); it is correct as CSRF defense but is not an access control. Do not count it against the direct-curl attacker.

**F8 (Low)** — Most mutation 500s leak `detail: err.message` (e.g. `app/api/posts/route.ts:180,210,273`), disclosing schema/constraint internals. Minor recon aid.

**F9 (Low)** — Dead `authenticated`/`auth.uid()` RLS policies exist on likes/bookmarks/follows/consents/storage; they fail closed (never grant for real traffic) but are a latent footgun if anyone ever wires Supabase auth.

**F10 (Low)** — SECURITY DEFINER functions default to PUBLIC EXECUTE (`0003` never REVOKEs from PUBLIC). The trigger-shaped ones error out unless called in trigger context, so not exploitable, but the posture relies on function shape, not an explicit REVOKE.

**F11 (Low, latent) — `posts` direct-read policy ignores `published_at`.** `posts: public read non-deleted` (`0002:423-427`, extended in `0017:237-252`) filters only `deleted_at IS NULL`, but the two read RPCs `search_posts` (`0010:76-77`) and `feed_shortlist_by_heat` (`0009:60-61`) both also require `published_at <= now()`. Today this is latent, not live: `app/api/posts/route.ts` (Step 13, `:255-268`) never sets `published_at`, so it defaults to `now()` and no future-dated post can exist. But the two read paths disagreeing is a defense-in-depth gap: if scheduled publishing is ever added, a future-dated post's full `body_md`/`author_id` would be readable via a direct anon `GET /rest/v1/posts?published_at=gt.now`. One-line fix available.

**F12 (Low, fragile) — the `users: public read USING (true)` policy still exists.** `0002:398-402` grants unconditional SELECT on `public.users` (which carries `banned_at`, `banned_reason`, `signup_flags`). It is neutralized *only* by the `REVOKE SELECT ON public.users FROM anon, authenticated` in `0014:90`; the policy itself was never narrowed. Any future migration that re-issues `GRANT SELECT` on the table silently re-exposes ban state to the anon key. The safe projection view `users_public` should be the sole path.

**F13 (Low→Medium under threat (b)) — CSP ships Report-Only with no collector.** `next.config.ts:42` sends `Content-Security-Policy-Report-Only`. On an unwatched instance this means the CSP enforces nothing and nobody reads the reports. The config comment says the operator planned to watch reports for a week then flip to enforce; that plan assumes a watched launch. Flip to enforcing (after confirming zero violations on the current pages), since "watch for a week" is exactly what threat model (b) says will not happen.

### Positive confirmations (no action)

- **Git history is clean.** gitleaks over 305 commits found nothing; `.env`/`.env.local` were never tracked (`git log --all --full-history` empty); `.gitignore:34-35` ignores `.env*` with only `!.env.example` excepted, and `.env.example` holds empty placeholders. Rotation on go-public day is therefore precautionary, not breach-driven.
- **Direct PostgREST write surface is closed** (SELECT-only grants; no anon write policies).
- **sessions, accounts, reports (`0002`), and mod_actions audit log (`0002`) are not anon-readable.** Verified against the policies.
- **Admin mutation routes and the per-request ban recheck (`lib/auth.ts:802-820`) are correctly enforced.**
- **The a11y gate already runs in CI**: `pnpm e2e` runs `playwright test` with `testDir:'./tests/e2e'` and no `testIgnore`, so it executes `a11y.spec.ts` too (`playwright.config.ts:29`, `package.json` scripts). The separate `pnpm a11y` script is a subset convenience runner.

---

## 2. Open questions (could not verify from the repo; answers change the plan)

1. **RESOLVED (C1) — clean slate.** Existing users do not retain access; only the owner login(s) from `ADMIN_GITHUB_LOGINS` are seeded. Everyone else re-applies via email. No grandfather backfill. Implemented in Phase 1.
2. **`signIn` for unapproved: deny session, or allow read-only?** Recommended: **deny** (redirect to `/auth/apply`). Justification in Phase 1. Confirm you agree.
3. **Mail provider for harshit@agentlab.in.** No evidence anywhere in repo/docs/`.env.example` (the app sends no transactional mail; the address is only a `mailto:`). Exact SPF/DKIM/DMARC values are provider-specific and cannot be written until you name the provider (Google Workspace / Fastmail / Zoho / etc.).
4. **Which domain is live in Vercel right now, and what is the OAuth callback URL?** `README.md:4` says `dev.agentlab.in`; `docs/runbook-backup.md` targets `agentlab.in`. NextAuth derives the callback purely from `NEXTAUTH_URL` at runtime, so this must be read from the Vercel env + GitHub OAuth App settings, not the repo.
5. **Is Upstash actually configured in prod, and is `RATE_LIMIT_FAIL_OPEN` set?** `.env.example` lists the vars but real values are not in the repo (correct). F3 severity assumes they may be unset/flaky.
6. **RESOLVED (C3) — promoted to a hard gate.** Confirming the live `supabase_migrations.schema_migrations` ledger and renumbering `0024` to match is now a blocking first step at the top of Phase 1's verification, not a footnote. See Phase 1.
7. **Live deploy env for the E2E shim.** Confirm the live deploy runs `NODE_ENV=production` and has no `ALLOW_E2E_AUTH` set; the shim (`lib/auth.ts:761-791`) is safe by construction but this is a runtime value I cannot read.

---

## 3. Phased implementation plan

Ordering guarantees the system is never less secure than today. Phase 1 (the approval lockdown) lands before any gate is relaxed. Phase 4 (dropping the consent 412) runs only after Phase 1 has replaced it with a stronger gate.

Migration numbers below assume the next free number is `0024`; confirm against open question 6 before applying.

**PR grouping (keeps CI green throughout):** Phase 0 is settings-only. Land Phase 1 as one PR (migration `0024` + the three `lib/auth.ts` edits + the `tests/e2e/global-setup.ts` approval seed) so the DB gate and the test seed arrive together, or the write-path e2e suite goes red. Land Phases 2–4 (registration page, legal collapse, consent removal) as a second PR: they touch an almost disjoint file set and mixing them only enlarges review blast radius. Phase 5 items are independent and can ride either PR or their own. Phase 6 is the launch-day checklist, run last.

### Phase 0 — Zero-risk repo hardening (no code, no schema)

**Goal:** raise the floor before anything else, entirely in GitHub/Vercel settings.

- GitHub → Settings → Code security: enable Secret scanning, Push protection, Dependabot alerts, Dependabot security updates. Push protection is the load-bearing one (a public repo's history is permanent; blocking the bad push is the only real defense).
- Add `.github/dependabot.yml` scoped narrowly (github-actions weekly; npm security-only via the repo toggle above). File body in Phase 5.

**Test impact:** none. **Verification:** the four toggles show Enabled; a test push containing a fake `ghp_...` token is rejected by push protection.

**Rollback:** disable the toggles; delete `dependabot.yml`. Nothing else depends on this.

### Phase 1 — Approval gate (the core lockdown)

**Goal:** nobody writes unless present in `approved_users`. Enforced in the DB (trigger, the true invariant) with `getSession` and `signIn` as convenience layers. This phase only *removes* write ability, so the system is strictly more secure the moment it lands.

**DB — migration `0024_approved_users.sql` (forward-only, non-destructive):**

- Table (key on `github_login`, lowercased, not on `public.users.id`, to avoid a chicken-and-egg problem: an applicant has no `public.users` row until their first approved sign-in, but you approve them by GitHub login from their email):
  ```sql
  CREATE TABLE public.approved_users (
    github_login      text PRIMARY KEY CHECK (github_login = lower(github_login)),
    approved_at       timestamptz NOT NULL DEFAULT now(),
    -- C2: NULLABLE and truthful. Set ONLY when the owner records a genuine
    -- "I agree to the terms at agentlab.in/terms" email reply for this
    -- applicant. NEVER backfill this from public.consents (0022) — that
    -- ceremony agreed to different documents; copying it here would
    -- manufacture a false acceptance record. Do not reintroduce a synthetic
    -- timestamp in any future edit.
    terms_accepted_at timestamptz,
    approved_by       text NOT NULL DEFAULT 'harshit@agentlab.in',
    notes             text
  );
  ```
  RLS: `ENABLE ROW LEVEL SECURITY` with **no anon policy** (default-deny; service-role writes it), consistent with the F6 invariant.
- **Clean slate (C1, resolves open question 1): no grandfather backfill.** Existing users do not retain write access. Seed only the owner login(s) from `ADMIN_GITHUB_LOGINS` (lowercased) so admin sign-in and the moderation back office keep working. The owner row's `terms_accepted_at = now()` is truthful (the owner authored the terms):
  ```sql
  -- Seed owner/admins only. Parameterize the login list to match the exact
  -- value of ADMIN_GITHUB_LOGINS at cutover; example shows the single owner.
  INSERT INTO public.approved_users (github_login, approved_at, terms_accepted_at, approved_by)
  VALUES ('harshitsinghbhandari', now(), now(), 'system:owner-seed')
  ON CONFLICT DO NOTHING;
  ```
  Every other existing user re-applies through the email flow like a new applicant. No "has posted before" shortcut. Their already-published posts stay readable (reads are anon and ungated); only their ability to write is revoked.
- One generic enforcement function + per-table triggers (DRY; the owner column name is passed via `TG_ARGV`):
  ```sql
  CREATE FUNCTION public.enforce_author_approved() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DECLARE owner_col text := TG_ARGV[0]; owner_id uuid; ok boolean;
  BEGIN
    EXECUTE format('SELECT ($1).%I', owner_col) INTO owner_id USING NEW;
    SELECT EXISTS (
      SELECT 1 FROM public.approved_users a
      JOIN public.users u ON lower(u.github_login) = a.github_login
      WHERE u.id = owner_id
    ) INTO ok;
    IF NOT ok THEN RAISE EXCEPTION 'writer not approved'; END IF;
    RETURN NEW;
  END; $$;
  ```
  Attach `BEFORE INSERT` triggers passing the correct owner column per table: `posts(author_id)`, `comments(author_id)`, `likes(user_id)`, `bookmarks(user_id)`, `follows(follower_id)`, `reports(reporter_id)`, `post_tags` (via parent post author), `post_versions`/`post_references` (via parent post author). **Verify the exact owner-column names against `0002_content.sql` before finalizing** (I confirmed `posts.author_id` at `app/api/posts/route.ts:257`; the rest need a one-line check each). Admin restore/moderation paths insert as the owner or admin; admins are in `approved_users` via the seed, so they pass.
  - **C6 — required migration comment on the dynamic SQL:** `enforce_author_approved()` is `SECURITY DEFINER` and builds `format('SELECT ($1).%I', owner_col)`. Add this sentence verbatim above the function: "`owner_col` is supplied only by `TG_ARGV`, which is fixed in this migration's `CREATE TRIGGER` DDL; no runtime or user-supplied input ever reaches the dynamic SQL, and `search_path` is pinned to `public, pg_temp`, so the `%I` interpolation is not an injection surface." So a future reader does not re-derive the safety argument.

**App layer (convenience, single choke points, near-zero per-route churn):**

- `lib/auth.ts` — add `isApproved(login)` and `resolveIsApproved(userId)` mirroring the existing `isAdmin`/`resolveIsAdmin` (`lib/auth.ts:141-172`).
- `lib/auth.ts` `getSession()` — add an approval recheck right beside the existing per-request ban check (`lib/auth.ts:802-820`): if the session user's login is not approved, return `null`. Because every write route already does `const session = await getSession(); if (!session?.user?.id) return 401`, this **gates every authenticated route, including `/api/uploads` (which writes to storage, not a trigger-guarded table), with no per-route edits**, and makes revocation instant (delete the row, next request drops the session). Admins bypass via being seeded approved.
  - **C5 — one round-trip, not two (India-RTT is the owner's worst surface).** Verified: the current ban check is a single service-role query `admin.from('users').select('banned_at').eq('id', session.user.id).maybeSingle()` (`lib/auth.ts:804-808`), and `getSession()` has no per-request memoization (it re-runs `getServerSession` + this query each call). Do **not** add a second query for approval. Migration `0024` adds a SECURITY DEFINER function `resolve_session_gate(p_user_id uuid) RETURNS TABLE(banned_at timestamptz, is_approved boolean)` that reads `users.banned_at` and the `approved_users` existence in one statement; `getSession()` replaces the ban-only query with a single `admin.rpc('resolve_session_gate', { p_user_id })` call, then drops the session if `banned_at` is set OR `is_approved` is false. Net round-trips versus today: unchanged (one). The join `approved_users.github_login = lower(users.github_login)` cannot be a PostgREST resource-embed (no FK), which is exactly why the combined function is used rather than two `.from()` calls.
- `lib/auth.ts` `signIn` callback — after `evaluateGate` and the ban checks, if the login is not in `approved_users`, `return '/auth/blocked?reason=not_approved'` (add a `not_approved` branch to `app/auth/blocked/page.tsx` that links to the apply page). **Match the login the way the existing ban check does: use the freshly-fetched `gh.login.toLowerCase()`, NOT `next_auth.users.github_login`.** Timing fact (verified): at `callbacks.signIn` time the adapter has inserted the `next_auth.users` row but its `github_login` audit column is not populated until `events.signIn` runs *after* the callback returns (`lib/auth.ts:595-701`), so a DB-column match would read null. The ban check at `lib/auth.ts:479-485` already matches on `gh.login`; the approval check sits right beside it and uses the same value. **Recommendation: deny (redirect), do not grant a read-only session.** Rationale: reading requires no session at all (anon reads the entire site), so a signed-in-but-powerless session adds surface and confusion for zero benefit, and denial reuses the existing blocked-redirect pattern and leaves no half-provisioned state beyond the orphaned adapter rows rejected signups already produce today.
- **C7 — uploads is app-layer-only; mark it.** `/api/uploads` writes to `storage.objects`, which has no approval trigger behind it (storage's `owner` column is never set on service-role uploads, per the product audit), so the `getSession()` approval recheck is its **only** enforcement layer, unlike the trigger-guarded content tables which have two nets. This is acceptable. Add a code comment at the write path in `app/api/uploads/route.ts` (right where `session.user.id` is used, currently `:50-57`) stating that the app-layer gate is load-bearing here with no DB invariant behind it, so a future editor who refactors `getSession()` knows uploads has no second net.
- **Admins:** the owner and any `ADMIN_GITHUB_LOGINS` entry are seeded into `approved_users` (above), so the `getSession`/`signIn` approval checks pass for them. This keeps admin a strict superset of approved and avoids a separate exemption branch. `evaluateGate` stays untouched as a cheap pre-filter (keeps `auth-gate.test.ts` green).

**Test impact:**
- `tests/e2e/global-setup.ts` — insert the shim user's github_login into `approved_users` so every write-path e2e spec (publish, engagement, comments, editor, orgs) stays green. The shim user is `00000000-0000-4000-8000-000000000001` (`playwright.config.ts:68-69`).
- ADD `tests/unit/migration-0024.test.ts` (table + trigger shape, mirroring `migration-0022.test.ts`), `tests/unit/auth-approval.test.ts` (pure `isApproved`), and one e2e asserting an unapproved (approval-row-absent) user gets 401/redirect on POST `/api/posts`.
- `tests/unit/auth-session.test.ts` — extend to cover the new `getSession` approval branch.

**Verification (proves the phase worked):**
- **C3 — HARD GATE, do this before applying `0024` (resolves open question 6):** run `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;` against the **running production** database and confirm the highest applied version and that no `0024` exists. Given the known `0018`/`0019` numbering gap and the `0013→0017` renumber, the repo's filename numbering may not match the live ledger. If they disagree, renumber the new migration to the next free number **in the live DB** and note the chosen number in the migration header. Do not apply any migration, and do not proceed with Phase 1, until this check passes. A stranger running this plan must treat this as a blocking step, not a footnote.
- **C1 — existing-author read-yes / write-no:** pick an existing author who is NOT seeded into `approved_users`. Confirm their profile and posts still render for an anonymous visitor (reads are ungated), AND that a signed-in write as that author is rejected: an e2e POST to `/api/posts` returns 401 (session dropped by `getSession`), and a direct service-role `INSERT INTO posts (author_id, ...)` for that author raises `writer not approved` from the trigger. This proves the clean-slate cutover revokes writing without touching the showcase content.
- With the shim user removed from `approved_users`, the same 401 + trigger-rejection holds; with the shim user seeded approved, the full write suite passes.
- Anon read of `/` and any post page is unaffected.

**Rollback:** the migration is additive; to revert, `DROP` the triggers and function and (optionally) the table. No data is destroyed. App-layer: revert the three edits in `lib/auth.ts`. Because the triggers only *reject*, dropping them restores prior behavior exactly.

### Phase 2 — Registration surface → "apply by email"

**Goal:** the public entry point tells people how to apply; the GitHub button stays for approved users to log in.

- ADD `app/auth/apply/page.tsx` (static server component): instructions to email harshit@agentlab.in explaining why they should be allowed to post; the joke "average review time ~200 days" as a **hardcoded static string** (no counter infra, no cron, no DB — satisfies "no operational burden"); the required reply line "I agree to the terms at agentlab.in/terms"; a link to `/terms`.
- EDIT `app/auth/signin/page.tsx` — keep the "Continue with GitHub" button (approved users still sign in through it; `signIn` redirects unapproved to `/auth/apply`). Replace the copy line "New accounts are subject to a brief eligibility check." (`app/auth/signin/page.tsx:40`) with a one-liner pointing at `/auth/apply`.
- `signIn` callback already redirects unapproved to `/auth/apply` (Phase 1), so no additional wiring.

**Test impact:** UPDATE `tests/e2e/auth.spec.ts` and `tests/unit/components/nav-auth.test.tsx` if they assert the old signin copy; ADD a trivial render test for `/auth/apply`.

**Verification:** unapproved GitHub sign-in lands on `/auth/apply`; approved sign-in completes to `/`.

**Rollback:** delete `app/auth/apply`, restore the signin copy line.

### Phase 3 — Legal consolidation to a single `/terms`

**Goal:** one plain-voice page combining terms + privacy; every other legal URL redirects to it.

- REWRITE the terms content. Legal pages are thin wrappers: `app/(legal)/terms/page.tsx` renders `<LegalPage slug="terms" />`, which renders `legal/terms-of-service.md` via `lib/legal/render.ts` + `components/legal/LegalPage.tsx`. Rewrite `legal/terms-of-service.md` into the combined plain-voice doc (you own what you post; the owner can remove anything and revoke anyone with no appeals; only email + GitHub identity are collected; complaints go to harshit@agentlab.in). Keep the existing loader; only the markdown changes.
- DELETE the other legal route pages and their markdown: `app/(legal)/{privacy,policy,grievance,dmca}/page.tsx` and `legal/{privacy-policy,content-policy,dmca-policy,grievance-officer}.md`.
- ADD a `redirects()` block to `next.config.ts` (it currently has **none** — only `headers()` and `images`, verified `next.config.ts:55-91`): permanent redirects `/privacy`, `/policy`, `/grievance`, `/dmca` → `/terms`.
- EDIT `components/layout/Footer.tsx:3-9` — collapse `FOOTER_LINKS` to a single `{ label: 'Terms', href: '/terms' }`.
- Grep for stragglers: `app/(legal)/grievance/page.tsx`, `app/auth/consent-declined/page.tsx`, `app/auth/consent/ConsentForm.tsx`, and `legal/*.md` cross-links to the removed routes (several exist per the search); repoint them to `/terms`. Also update `lib/legal/metadata.ts`/`legalMetadata` entries for removed slugs.

**Test impact:** UPDATE `tests/e2e/legal.spec.ts` and `tests/unit/legal.test.ts` (removed routes now redirect; assert 308→/terms and the new single footer link). `tests/unit/legal-versions.test.ts` can stay (versions const still exists) or be trimmed to `terms` only.

**Verification:** `/privacy`, `/policy`, `/grievance`, `/dmca` all 308 to `/terms`; `/terms` renders the combined doc; footer shows one link; a11y spec still passes.

**Rollback:** restore the deleted pages/markdown from git; remove the `redirects()` block; restore `FOOTER_LINKS`. Pure content, no data.

### Phase 4 — Retire the consent ceremony (runs only after Phase 1)

**Goal:** remove the signup consent flow now that approval + the email "I agree" reply replace it. Non-destructive to the `consents` table (kept as engineering/audit proof, per the mission's "tools I have, not process I promise").

- Drop `requireConsent: true` from all 25 `guardMutatingRequest` call sites (grep `requireConsent`, same files the Phase-1 approval check touches, so do both edits per route in one pass). Then delete the guard's `requireConsent` branch and option in `lib/route-guard.ts:98-127` plus its `loadLatestConsent`/`decideConsentRedirect` import.
- Delete the page-level redirect calls: `requireConsentOrRedirect(userId)` is invoked from `app/page.tsx`, `app/bookmarks/page.tsx`, `app/settings/profile/page.tsx`, `app/write/page.tsx`, `app/write/[postId]/page.tsx`, and `app/admin/layout.tsx` — remove each call and its import.
- DELETE the ceremony UI/flow and libs: `app/auth/consent/page.tsx`, `app/auth/consent/ConsentForm.tsx`, `app/auth/consent-declined/page.tsx`, `lib/consent/server-actions.ts` (the only `'use server'` module), `lib/consent/consent-guard.ts`, `lib/consent/require-consent.ts`, and `components/settings/ConsentSnapshotSection.tsx` plus its render + `consentRow` query in `app/settings/profile/page.tsx`. Once nothing imports them, delete `lib/consent/` entirely and `lib/legal/versions.ts` (its `staleConsentDocs`/`StoredConsentVersions` are then dead); verify no remaining import first.
- KEEP: the `consents` table and `0022` migration (no destructive migration; the append-only trigger and CASCADE stay), as engineering/audit proof. **C2 reminder:** the retained `consents` data must never be read back into `approved_users.terms_accepted_at` (it agreed to different documents); the table stays purely as a dead audit record.

**Test impact:** DELETE `tests/e2e/consent-gate.spec.ts`, `tests/unit/consent-guard.test.ts`, `tests/unit/consent-server-action.test.ts`, `tests/unit/require-consent.test.ts`, `tests/unit/route-guard-consent.test.ts`. KEEP `tests/unit/migration-0022.test.ts` (table stays). UPDATE: `tests/setup.ts` removes its global `vi.mock('@/lib/consent/consent-guard', ...)` block (it mocks a deleted module); `tests/unit/profile/settings-page.test.tsx` drops the consent-snapshot assertions; any route test asserting a 412 consent path (e.g. `tests/unit/api/mdx-preview.test.ts`); `tests/unit/legal-versions.test.ts` (trim to `terms` or delete if `versions.ts` is deleted).

**Verification:** an approved user writes a post with no consent row present and gets 201 (no 412); the `consents` table still exists (`\dt public.consents`); suite green.

**Rollback:** restore the deleted files and the `requireConsent: true` flags from git. The table never changed.

### Phase 5 — Close the incidental findings (F2–F6)

**Goal:** fix the audit findings that a public repo makes cheap to exploit.

- F2: add `const session = await getSession(); await requireAdmin(session)` (or gate inside each `lib/admin/*` DAL function) at the top of `app/admin/{page,users,reports,tags,orgs,audit}/page.tsx`. Defense-in-depth per-request, independent of the layout.
- F3: set `RATE_LIMIT_FAIL_OPEN=false` in Vercel for the `publish` and `report` buckets' posture (confirm Upstash is configured; open question 5). No code change if the env var is honored globally; if per-bucket, small edit in `lib/rate-limit.ts`.
- F4: `REVOKE EXECUTE ON FUNCTION public.increment_post_view_count(...) FROM anon;` in migration `0024` (or a small `0025`). **C8 — confirmed the revoke does not break the legit path:** the real view-count route `app/api/posts/[id]/view/route.ts:60,69` calls the RPC through `createAdminSupabaseClient()` (service-role), which bypasses the revoke; the anon client is never used there. So the revoke closes the direct anon-PostgREST write while leaving real view counting intact. No route change needed. If you instead accept the vanity-counter risk, document it in `docs/security-audit-ignores.md`; recommendation is to revoke (one-line, forward-only).
- F5: set `ADMIN_GITHUB_LOGINS=` (empty) in `.env.example:29`. The real value lives in Vercel env only.
- F6: add a comment/invariant to `0024` and a note in the backup runbook: never `GRANT USAGE ON SCHEMA next_auth TO anon`; every new `public` table must `ENABLE RLS` with no anon policy. Optionally a cheap unit/migration test asserting anon lacks `next_auth` USAGE.
- F11: add `AND published_at <= now()` to the `posts: public read non-deleted` policy in migration `0024`, mirroring the two read RPCs. One-line, forward-only; closes the latent scheduled-post read path before any scheduling feature could open it.
- F12: `DROP POLICY "users: public read" ON public.users;` in `0024` so the `users_public` view is the sole anon read path and a stray future `GRANT SELECT` can't re-expose ban state. The view already covers every legitimate anon read (`0014:59-70`).
- F13 (**C4 — ships as its own commit with its own rollback, NOT batched with F2/F4/F12**): CSP is the one change that breaks rendering silently with no server error, and the instance is unwatched by design, so it must be isolatable. **Default to (a):** keep `Content-Security-Policy-Report-Only` and add a `report-uri`/`report-to` directive pointing at a collector endpoint that forwards violations to harshit@agentlab.in, so violations surface without anyone watching a console. **Option (b), only if you can guarantee the prod page-walk:** flip to enforcing `Content-Security-Policy`, but first load **every distinct page type in production** with the enforcing header and confirm zero console violations: home, a post with code + Mermaid, the editor, an `/admin/*` page, `/auth/apply` (or `request-access`), and `/terms`. Local verification is insufficient because prod has different nonces, analytics, and Vercel-injected scripts. Rollback for either: revert the single `next.config.ts:42` header line; nothing else depends on it.
- CI: add `permissions: contents: read` and a `concurrency` block to `.github/workflows/ci.yml` (no secrets are referenced today, and it uses `pull_request` not `pull_request_target`, so fork PRs are already safe; this is hardening for when a deploy/publish job is later added). Optionally add a named `pnpm a11y` step for triage visibility (coverage already exists).

**Test impact:** ADD an e2e asserting a non-admin authenticated user gets 404 on `/admin/users` directly (not just via nav). Existing admin e2e (`tests/e2e/admin.spec.ts`) stays green (shim user must be seeded admin+approved).

**Verification:** direct GET `/admin/users` as a non-admin returns 404; `increment_post_view_count` via anon PostgREST returns permission-denied; CI run shows the tightened `permissions`.

**Rollback:** each item is independent and revertible (env value, one REVOKE, per-page guard, YAML block).

### Phase 6 — Go-public day runbook (ordered)

Rotate secrets **before** flipping visibility (history becomes permanently public the instant it flips; rotating first means any hypothetical exposure is already dead).

1. Rotate `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard → regenerate → update Vercel Production env immediately; highest blast radius, bypasses RLS), then `NEXTAUTH_SECRET` (`openssl rand -base64 32` → Vercel), then `GITHUB_CLIENT_SECRET` (GitHub OAuth App → new secret → Vercel). Optionally `UPSTASH_REDIS_REST_TOKEN` (hygiene). Redeploy.
2. Confirm `git ls-files | grep -E '^\.env' | grep -v '.env.example'` is empty.
3. Confirm `/api/health` returns 200 `{ok:true,db:'ok'}` on the live domain (proves the new service-role key works).
4. Verify the GitHub OAuth App "Authorization callback URL" exactly matches `<NEXTAUTH_URL>/api/auth/callback/github` for whichever domain is live (open question 4). Complete one real GitHub sign-in as an approved user.
5. Flip repo visibility to Public (GitHub → Settings → Danger Zone).
6. Smoke tests: anon reads `/` and a post page (200, content renders); unauthenticated POST `/api/posts` → 401; approved user publishes → 201; unapproved user sign-in → `/auth/blocked?reason=not_approved` (linking to the apply page); admin login reaches `/admin`; `gh repo view --json isPrivate` → `false`; secret scanning + push protection show Enabled.
7. **C1 clean-slate confirmation at launch:** `SELECT count(*) FROM approved_users;` returns only the seeded owner/admin login(s) (no grandfathered rows). Pick one pre-existing non-seeded author and confirm their profile + posts still render for anonymous visitors, but a signed-in write attempt as that author is rejected (session dropped → 401). This is the launch-time proof that the cutover revoked writing without harming the showcase.

**Rollback:** repo visibility can be flipped back to Private instantly. Rotated secrets stay rotated (no reason to revert). If a smoke test fails, revert the offending Vercel env change; the prior deploy is one click in Vercel's Deployments tab.

---

## 4. Deliberately not doing (and why)

- **RLS-keyed-on-approval policies.** Explained in §0: dead for this architecture (service_role bypass; no `authenticated` JWT). The trigger is the correct DB invariant. Adding the RLS policies too would be theater that implies a control that does not exist.
- **Deleting the moderation back office, `consents` table, migrations, or tests.** The mission says keep them as engineering proof. Phase 4 removes the consent *ceremony* but keeps the table and its migration.
- **A dynamic "days since launch" / real average-review-time counter.** The brief calls it a joke and forbids operational burden. A hardcoded "~200 days" string satisfies it with zero infra.
- **Rewriting `evaluateGate` or the ban/fingerprint machinery.** Approval supersedes the heuristic, but `evaluateGate` is a harmless cheap pre-filter; removing it is churn with no security gain and would break `auth-gate.test.ts`. Minimal-diff wins.
- **Fixing F7 (origin-only CSRF) and F9 (dead auth.uid policies).** F7 is correct as CSRF defense; the real write control is auth + approval + rate-limit. F9 fails closed. Neither is exploitable; touching them is taste-refactoring the non-goals forbid.
- **A CI-based automated backup pipeline.** The ops analysis recommends Supabase Pro (a subscription toggle) over building/maintaining a GitHub Actions `pg_dump` job; lower total effort and neglect-proof. Deferred to your cost decision, not built.
- **Writing exact SPF/DKIM/DMARC records.** Blocked on the mail provider (open question 3). The generic shapes and the `p=quarantine` starting posture with `rua` reporting to harshit@agentlab.in are documented; exact values wait on the provider.
- **F8 error-message scrubbing.** Low-value recon aid; a global error-response helper is a repo-wide refactor the non-goals exclude. Noted, not done.
