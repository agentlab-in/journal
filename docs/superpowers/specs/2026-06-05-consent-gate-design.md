# Consent Gate at Signup — Design Spec

**Date:** 2026-06-05
**Issue:** [#57](https://github.com/harshitsinghbhandari/agentlab-in/issues/57)
**Branch:** `feat/consent-gate` (PRs into `develop`)
**Milestone:** Pre-launch (June 7 deadline)
**Status:** Approved (defaults from issue body + orchestrator brief)

## Goal

Capture explicit, recorded user consent for **18+ status + Terms of Service + Content Policy + Privacy Policy** before a first-time signup completes, and re-prompt on doc-version bumps. Required for DPDP Act 2023 §9 and to make the legal docs enforceable.

## Non-Goals

- Cookie consent banner — we set only strictly-necessary session cookies.
- Marketing / newsletter opt-in — v1 has no marketing email.
- Parental-consent flow for under-18 — sidestepped by forbidding under-18 accounts.
- Re-implementing the legal markdown rendering (shipped in PR #55).
- DMCA / Grievance Officer acknowledgement — operator notices, not user contracts.

## Architecture

Five surfaces compose the gate:

1. **`public.consents` table** — append-only audit log of consent rows.
2. **`lib/legal/versions.ts`** — semver-style version constants per doc.
3. **`/auth/consent` page + server action** — UI gate with 4 required checkboxes and server-side validation.
4. **`/auth/consent-declined` page** — terminal "you cannot use the platform" landing for refusals.
5. **Consent enforcement** — page-level `requireConsentOrRedirect()` helper called by each authed server component after `getSession()`, plus a `requireConsent` opt-in on `guardMutatingRequest` for mutating API routes. Both compose the same pure `consent-guard` primitives. No top-level `middleware.ts` is added (DB lookup at the edge is brittle in Next 16 with database sessions).
6. **Settings visibility** — `/settings/profile` shows the user's current consent snapshot.

### Data flow (first-time signup)

```text
GitHub OAuth callback
  → next_auth.users insert (adapter)
  → events.signIn fires (audit cols, org sync, signup flags)
  → session cookie written
  → user lands on /  (or original next URL)
  → getSession() reads consent state for user
  → no consent row OR version mismatch → return null + redirect target
  → page logic redirects to /auth/consent
  → user ticks 4 boxes + submits
  → server action validates all 4 booleans true
  → server action reads LEGAL_VERSIONS at submission time
  → insert into public.consents with current versions, IP, UA
  → redirect to "/" (or the post-consent next URL)
```

### Data flow (refuse / back out)

```text
user clicks Decline (or closes tab without ticking)
  → POST /auth/consent/decline server action
  → delete from next_auth.sessions where userId = current   (revoke cookie first)
  → delete from next_auth.users where id = current          (CASCADE: accounts + public.users)
  → redirect to /auth/consent-declined
  → cookie is now stale; page renders sign-in-again link
```

Cleanup ordering rationale: deleting sessions first invalidates the cookie before the user row vanishes, so a parallel request can't act against a half-deleted user. The CASCADE on `next_auth.users` removes the accounts row and (via `public.users.id` FK) the public profile row.

### Data flow (version-bump re-prompt)

```text
operator bumps lib/legal/versions.ts (e.g. terms 'v1' → 'v2'), edits the markdown,
  updates the doc's effective-date / version header, ships
existing user makes any authed request
  → getSession() or consent-guard reads latest consents row for user
  → versions differ from LEGAL_VERSIONS
  → redirect to /auth/consent with ?banner=updated_terms (or whichever doc(s) bumped)
  → user re-ticks, server inserts a new consents row
```

### Mid-signup version-bump edge case

Decision: the server action re-reads `LEGAL_VERSIONS` at submission time, not from a hidden form field on the rendered page. The consent row reflects whichever versions the docs **currently show**. The user's tick implicitly accepts the live versions. This is safer than persisting a stale-from-render version: we never record consent to a version the user couldn't see at submission time.

## Schema

### Migration `0022_consents.sql`

```sql
CREATE TABLE public.consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  consented_at timestamptz NOT NULL DEFAULT now(),
  age_confirmed boolean NOT NULL,
  terms_version text NOT NULL,
  content_policy_version text NOT NULL,
  privacy_policy_version text NOT NULL,
  ip_address text,
  user_agent text
);

-- One consent row per user per version-triple. New triple → new row.
CREATE UNIQUE INDEX consents_user_versions_uniq
  ON public.consents (user_id, terms_version, content_policy_version, privacy_policy_version);

-- Look up the latest consent row for a user.
CREATE INDEX consents_user_latest_idx
  ON public.consents (user_id, consented_at DESC);

ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;

-- Users can read their own rows. Service role bypasses RLS.
CREATE POLICY consents_self_read ON public.consents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy for authenticated — only service role
-- (server action) writes. Refusing to expose writers via RLS is intentional.
```

### Version module

`lib/legal/versions.ts`:

```ts
export const LEGAL_VERSIONS = {
  terms: 'v1',
  content_policy: 'v1',
  privacy_policy: 'v1',
} as const

export type LegalDoc = keyof typeof LEGAL_VERSIONS

/**
 * Compare a stored consent row's versions against current LEGAL_VERSIONS.
 * Returns an array of docs that have been bumped since the row was written
 * (empty array = fully consented).
 */
export function staleConsentDocs(stored: {
  terms_version: string | null
  content_policy_version: string | null
  privacy_policy_version: string | null
} | null): LegalDoc[] { ... }
```

`legal/README.md` documents the bump workflow.

## Components

### `/auth/consent` (page)

Server component. Logic:

1. `getSession()` — if no session, redirect `/auth/signin`.
2. Read latest consent row for `session.user.id`.
3. Compute `staleDocs` array. If empty, redirect to home (no work to do — defense-in-depth, also makes the page navigable directly).
4. Render `<ConsentForm staleDocs={staleDocs} bannerKind={firstVisit | updated} />`.

Client component `<ConsentForm>`:

- 4 controlled checkboxes.
- Submit button disabled until all 4 `true`.
- Submit POSTs to a server action with all 4 booleans + IP/UA captured.
- Decline button POSTs to a separate decline server action.
- Compact mono spacing matching `/settings/profile` (PR #51).

### `/auth/consent-declined` (page)

Static page. Copy: "You cannot use agentlab.in without agreeing to the Terms, Content Policy, and Privacy Policy." Links to all 3 docs + "Sign in again" → `/auth/signin`.

### Server actions

- `recordConsent(formData)` — validates all 4 boxes true; reads `LEGAL_VERSIONS`; reads IP from headers; inserts into `public.consents`; redirects.
- `declineConsent()` — deletes sessions first, then user row; redirects to `/auth/consent-declined`.

Both use the admin Supabase client (service role) since the writes target tables not exposed via RLS to the authenticated role.

### Consent guard library

`lib/consent/consent-guard.ts`:

- `loadLatestConsent(supabase, userId): Promise<ConsentRow | null>`
- `decideConsentRedirect(row): { needs: 'first' | 'update' | null, staleDocs: LegalDoc[] }`

Pure decision functions, easy to unit test in isolation.

### Enforcement points

1. **Page-level helper `requireConsentOrRedirect(userId)`** — each server component that should require consent calls it right after `getSession()`. It loads the latest consent row via `consent-guard`, and either returns `void` (pass-through) or calls Next's `redirect('/auth/consent')` (which throws to terminate the render). Anonymous-allowed pages (home feed) call it conditionally only when a session is present.

2. **API guard opt-in via `guardMutatingRequest`** — `requireConsent?: boolean` option, **default `false`** (every handler opts in explicitly). When set, the guard performs the consent check using the same `consent-guard` primitives, and returns 412 (Precondition Failed) `{ error: 'consent_required', stale: [...] }` for stale users. Fail-CLOSED on lookup error and on `requireConsent=true` with a missing `userId`. `/api/auth/*`, `/api/health`, and `/api/users/me` (self-delete) MUST NOT opt in — those paths must be reachable without a current consent.

3. **No top-level `middleware.ts`** — Next 16 edge middleware with a database session would require a Supabase call from edge for every request, which is brittle and costly. The page-helper + API-guard model gives equivalent coverage with explicit, testable callsites. The brief's "Add a Next middleware OR extend the existing route-guard" wording authorises this choice.

### Settings visibility

In `app/settings/profile/page.tsx`, between `<OrgsListSection>` and `<DeleteAccountSection>`, render `<ConsentSnapshotSection consent={latestConsentRow} />`. Shows: "You agreed to Terms v1, Content Policy v1, Privacy Policy v1 on YYYY-MM-DD." If no row exists, show "No consent on record" (shouldn't happen post-launch).

### Legal doc updates

Bump each of `legal/terms-of-service.md`, `legal/content-policy.md`, `legal/privacy-policy.md` to add a `**Version:** v1` line under the `**Effective Date:**` line. Append a short paragraph referencing the consent mechanism:

- **Terms §3 (Eligibility):** "By signing in, you confirm you are 18 or older and agree to these Terms; we record this consent in our database (timestamp, IP address, user agent, doc version)."
- **Privacy §2 (Data collected):** Add a sub-bullet for the consent record fields.
- **Content Policy §1 or top:** "Violations of this Policy, which you accepted at signup, can lead to suspension or ban."

## File Structure

```text
supabase/migrations/0022_consents.sql            NEW
lib/legal/versions.ts                            NEW
lib/legal/README.md                              NEW (bump workflow)
lib/consent/consent-guard.ts                     NEW
lib/consent/server-actions.ts                    NEW
app/auth/consent/page.tsx                        NEW
app/auth/consent/ConsentForm.tsx                 NEW (client)
app/auth/consent-declined/page.tsx               NEW
app/settings/profile/page.tsx                    MODIFY (add ConsentSnapshotSection)
components/settings/ConsentSnapshotSection.tsx   NEW
lib/auth.ts                                      MODIFY (no surface change; helper next to getSession)
lib/route-guard.ts                               MODIFY (requireConsent option)
legal/terms-of-service.md                        MODIFY
legal/content-policy.md                          MODIFY
legal/privacy-policy.md                          MODIFY

tests/unit/legal-versions.test.ts                NEW
tests/unit/consent-guard.test.ts                 NEW
tests/unit/consent-server-action.test.ts         NEW
tests/unit/route-guard-consent.test.ts           NEW
tests/unit/migration-0022.test.ts                NEW
tests/e2e/consent-gate.spec.ts                   NEW
tests/e2e/a11y.spec.ts                           MODIFY (add /auth/consent)
```

## Testing

Unit:

- `staleConsentDocs(null)` → all three docs.
- `staleConsentDocs({ terms: 'v1', content_policy: 'v1', privacy_policy: 'v1' })` → `[]`.
- `staleConsentDocs({ terms: 'v0', content_policy: 'v1', privacy_policy: 'v1' })` → `['terms']`.
- `recordConsent` rejects when `age_confirmed=false`.
- `recordConsent` rejects when any policy box false.
- `recordConsent` reads versions at call time (test by injecting a versions module mock).
- `declineConsent` issues DELETE on sessions before DELETE on users (test via call-order spy on the supabase client).
- `guardMutatingRequest({ requireConsent: true })` returns 412 for users with no consent row.
- Migration test parses the SQL and asserts the unique index + RLS policies.

E2E:

- Fresh signup → `/auth/consent` → tick all 4 → home.
- Fresh signup → decline → `/auth/consent-declined`; verify no `next_auth.users` row remains (count check via admin client).
- Existing-user-with-no-consent → next visit to `/write` → redirected to `/auth/consent` with `?banner=first` (or `?banner=updated` — pick one for grandfather; spec choice: `updated` to keep copy honest with "we updated our policies").
- Bump `LEGAL_VERSIONS.terms` via `process.env.LEGAL_VERSIONS_OVERRIDE` (test-only injection) → consented user → redirected.
- Submit forged POST omitting one checkbox → server rejects, redirects back with error.

A11y:

- Axe scan of `/auth/consent` and `/auth/consent-declined`.

Verification gates (NON-NEGOTIABLE, all via `rtk proxy`):

- `rtk proxy pnpm typecheck`
- `rtk proxy pnpm lint`
- `rtk proxy pnpm test`
- `rtk proxy pnpm build`
- `rtk proxy pnpm e2e` (or a focused subset for speed)

## Open Decisions (resolved)

- **Decline destination:** `/auth/consent-declined` (dedicated page), not `/auth/signin`. Honest framing for refusers.
- **Banner copy for grandfathered users:** "We updated our policies — please review and confirm." Single string regardless of which doc(s) bumped to keep copy simple in v1.
- **Settings visibility:** Yes, small "Consent" subsection on `/settings/profile`. Per issue's open-question recommendation.

## Risks

- **Edge cases at the boundary of OAuth callback and consent gate.** If `events.signIn` fails partway (org sync 500), the user is created but consent gate still works (it's the next pageview that triggers the redirect). Verified.
- **The decline action races a pending mutation in another tab.** Worst case: a write hits a deleted user's session and 401s. Acceptable; consent decline is rare.
- **RLS for `consents` write path.** We use service role from server actions, bypassing RLS. Any direct client-side write attempt would be denied by absence of a policy.
