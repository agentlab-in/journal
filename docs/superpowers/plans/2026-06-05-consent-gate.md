# Consent Gate at Signup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. ALL verification commands MUST run via `rtk proxy <cmd>` (RTK silently filters bare `pnpm` output — verified gotcha in user memory).

**Goal:** Add an explicit, audited consent gate (18+, Terms, Content Policy, Privacy Policy) at first-time signup, with version-bump re-prompts and a refuse path that cancels signup.

**Architecture:** New `public.consents` table (append-only audit log) keyed by `(user_id, version-triple)`; version constants in `lib/legal/versions.ts`; new `/auth/consent` route with a server-validated 4-checkbox form; page-level `requireConsentOrRedirect` helper + extended `guardMutatingRequest` for API mutations; grandfather existing users via on-next-visit redirect.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), NextAuth v4 (database session strategy, Supabase adapter), Supabase Postgres + RLS, Vitest + Playwright + Axe, Tailwind v4 + project mono token system.

**Branch:** `feat/consent-gate` (PRs into `develop`, NEVER `main`).

**Closes:** [#57](https://github.com/agentlab-in/journal/issues/57)

**Pre-flight notes for every task:**
- `cd` to `/Users/harshitsinghbhandari/.agent-orchestrator/projects/agentlab-in_430706fffe/worktrees/age-41` (this worktree). Never `cd` to the canonical Downloads/ path.
- `pwd` before every git command.
- Run gates as `rtk proxy pnpm <cmd>` (not bare `pnpm`).
- Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Read referenced framework guides under `node_modules/next/dist/docs/` if you are unsure — `AGENTS.md` warns this is a non-standard Next build.

---

## Task 1: Migration `0022_consents.sql` + migration test

**Files:**
- Create: `supabase/migrations/0022_consents.sql`
- Create: `tests/unit/migration-0022.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `tests/unit/migration-0022.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0022_consents.sql'),
    'utf8',
  )
})

describe('0022_consents.sql shape', () => {
  it('creates public.consents table', () => {
    expect(migration).toMatch(/CREATE TABLE (IF NOT EXISTS )?public\.consents/)
  })

  it('uses uuid PK with gen_random_uuid default', () => {
    expect(migration).toMatch(/id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
  })

  it('user_id is FK to public.users with cascade delete', () => {
    expect(migration).toMatch(
      /user_id uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/,
    )
  })

  it('records the four required boolean and version columns', () => {
    expect(migration).toMatch(/age_confirmed boolean NOT NULL/)
    expect(migration).toMatch(/terms_version text NOT NULL/)
    expect(migration).toMatch(/content_policy_version text NOT NULL/)
    expect(migration).toMatch(/privacy_policy_version text NOT NULL/)
  })

  it('records audit columns (nullable)', () => {
    expect(migration).toMatch(/ip_address text/)
    expect(migration).toMatch(/user_agent text/)
  })

  it('consented_at defaults to now()', () => {
    expect(migration).toMatch(/consented_at timestamptz NOT NULL DEFAULT now\(\)/)
  })

  it('creates a unique index on (user_id, version triple)', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]+consents[\s\S]+\(user_id, terms_version, content_policy_version, privacy_policy_version\)/,
    )
  })

  it('creates a latest-consent lookup index', () => {
    expect(migration).toMatch(
      /CREATE INDEX[\s\S]+consents[\s\S]+\(user_id, consented_at DESC\)/,
    )
  })

  it('enables RLS', () => {
    expect(migration).toMatch(/ALTER TABLE public\.consents ENABLE ROW LEVEL SECURITY/)
  })

  it('creates a self-read policy for authenticated', () => {
    expect(migration).toMatch(
      /CREATE POLICY[\s\S]+ON public\.consents[\s\S]+FOR SELECT[\s\S]+TO authenticated[\s\S]+USING \(user_id = auth\.uid\(\)\)/,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
rtk proxy pnpm test tests/unit/migration-0022.test.ts
```

Expected: FAIL with ENOENT on the migration file.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0022_consents.sql`:

```sql
-- =============================================================================
-- 0022_consents.sql
-- Issue #57 — Consent gate at signup.
--
-- Append-only audit log of user consent to the four legal docs:
--   - 18+ self-confirmation (age_confirmed)
--   - Terms of Service (terms_version)
--   - Content Policy (content_policy_version)
--   - Privacy Policy (privacy_policy_version)
--
-- One row per user per version-triple — when any version bumps and the user
-- re-confirms, a new row is inserted; the prior row is retained for audit.
-- IP and user agent are captured at submission time for evidentiary value
-- in any future dispute.
--
-- Versions are managed in code (lib/legal/versions.ts), not DB.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.consents (
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

-- Prevent duplicate rows for the same user + version-triple.
CREATE UNIQUE INDEX IF NOT EXISTS consents_user_versions_uniq
  ON public.consents (user_id, terms_version, content_policy_version, privacy_policy_version);

-- Latest-consent lookup is the hot read path (per-request consent check).
CREATE INDEX IF NOT EXISTS consents_user_latest_idx
  ON public.consents (user_id, consented_at DESC);

ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;

-- Users can read their own consent rows (powers the /settings/profile snapshot).
CREATE POLICY consents_self_read ON public.consents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policy: only the service role (server actions)
-- writes to this table. Defence-in-depth against client-side forging.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
rtk proxy pnpm test tests/unit/migration-0022.test.ts
```

Expected: 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0022_consents.sql tests/unit/migration-0022.test.ts
git commit -m "feat(consent): add public.consents migration (#57)

Append-only audit log of user consent to Terms, Content Policy, and
Privacy Policy plus the 18+ self-confirmation. One row per user per
version-triple; CASCADE on user delete keeps the table clean when a
refused signup is reaped. Service-role only for writes; users can read
their own rows for the settings snapshot."
```

---

## Task 2: `lib/legal/versions.ts` + decision helper

**Files:**
- Create: `lib/legal/versions.ts`
- Create: `lib/legal/README.md`
- Create: `tests/unit/legal-versions.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/legal-versions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { LEGAL_VERSIONS, staleConsentDocs } from '@/lib/legal/versions'

describe('LEGAL_VERSIONS', () => {
  it('defines string versions for the three docs', () => {
    expect(typeof LEGAL_VERSIONS.terms).toBe('string')
    expect(typeof LEGAL_VERSIONS.content_policy).toBe('string')
    expect(typeof LEGAL_VERSIONS.privacy_policy).toBe('string')
  })
})

describe('staleConsentDocs', () => {
  it('returns all three docs when row is null', () => {
    expect(staleConsentDocs(null).sort()).toEqual(
      ['content_policy', 'privacy_policy', 'terms'].sort(),
    )
  })

  it('returns empty array when all three match current', () => {
    expect(
      staleConsentDocs({
        terms_version: LEGAL_VERSIONS.terms,
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual([])
  })

  it('returns only the bumped doc when one differs', () => {
    expect(
      staleConsentDocs({
        terms_version: 'v0',
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual(['terms'])
  })

  it('treats a null version on the row as stale', () => {
    expect(
      staleConsentDocs({
        terms_version: null,
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual(['terms'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
rtk proxy pnpm test tests/unit/legal-versions.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/legal/versions.ts`**

```ts
/**
 * Issue #57 — Legal-doc version constants.
 *
 * Bumping a value here is the operator's manual signal that a doc has
 * been edited materially enough to re-prompt every user. The version
 * string is recorded in public.consents at submission time; the
 * consent-guard compares the stored row's versions against these
 * constants on every authed request and redirects to /auth/consent
 * on any mismatch.
 *
 * Convention: semver-style ('v1', 'v2', …). Bump in lockstep with the
 * corresponding doc's frontmatter line; see lib/legal/README.md.
 */
export const LEGAL_VERSIONS = {
  terms: 'v1',
  content_policy: 'v1',
  privacy_policy: 'v1',
} as const

export type LegalDoc = keyof typeof LEGAL_VERSIONS

export interface StoredConsentVersions {
  terms_version: string | null
  content_policy_version: string | null
  privacy_policy_version: string | null
}

/**
 * Returns the list of docs whose stored consent version differs from
 * the current `LEGAL_VERSIONS`. A null row (no consent on record)
 * returns all three. An exact triple-match returns `[]`.
 *
 * Pure; safe to call from any context.
 */
export function staleConsentDocs(
  stored: StoredConsentVersions | null,
): LegalDoc[] {
  if (stored === null) {
    return ['terms', 'content_policy', 'privacy_policy']
  }
  const stale: LegalDoc[] = []
  if (stored.terms_version !== LEGAL_VERSIONS.terms) stale.push('terms')
  if (stored.content_policy_version !== LEGAL_VERSIONS.content_policy) {
    stale.push('content_policy')
  }
  if (stored.privacy_policy_version !== LEGAL_VERSIONS.privacy_policy) {
    stale.push('privacy_policy')
  }
  return stale
}
```

- [ ] **Step 4: Write `lib/legal/README.md`**

```markdown
# Legal versions workflow

Each user-facing legal doc (Terms, Content Policy, Privacy Policy) is
pinned to a semver-style string in `lib/legal/versions.ts`. The version
is recorded in `public.consents` when the user agrees, and re-checked
on every authed request.

## When to bump

Bump the version when the doc gains a new rule, alters an existing
obligation, or otherwise changes what the user agreed to. Typo fixes
and link rewrites are NOT bumps.

## How to bump

1. Edit the doc markdown in `legal/<doc>.md`.
2. Update the `**Version:**` line in the doc to match the new tag.
3. Bump the same value in `lib/legal/versions.ts`.
4. Open a PR. On merge, every user is re-prompted on their next
   authed page load.

Do not delete or rename a doc's key in `LEGAL_VERSIONS` — the consent
records reference these by name.
```

- [ ] **Step 5: Run test to verify it passes**

```bash
rtk proxy pnpm test tests/unit/legal-versions.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/legal/versions.ts lib/legal/README.md tests/unit/legal-versions.test.ts
git commit -m "feat(consent): add LEGAL_VERSIONS module and staleConsentDocs helper (#57)

Semver-style constants per doc. Bumping a value is the operator's
manual trigger for re-prompting every user. staleConsentDocs is the
pure decision function used by the consent guard."
```

---

## Task 3: Consent-guard library + tests

**Files:**
- Create: `lib/consent/consent-guard.ts`
- Create: `tests/unit/consent-guard.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/consent-guard.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { decideConsentRedirect, loadLatestConsent } from '@/lib/consent/consent-guard'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'

describe('decideConsentRedirect', () => {
  it('returns first-visit signal when row is null', () => {
    expect(decideConsentRedirect(null)).toEqual({
      needs: 'first',
      staleDocs: ['terms', 'content_policy', 'privacy_policy'],
    })
  })

  it('returns null when versions match', () => {
    expect(
      decideConsentRedirect({
        terms_version: LEGAL_VERSIONS.terms,
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual({ needs: null, staleDocs: [] })
  })

  it('returns update signal when one version differs', () => {
    expect(
      decideConsentRedirect({
        terms_version: 'v0',
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual({ needs: 'update', staleDocs: ['terms'] })
  })
})

describe('loadLatestConsent', () => {
  function mockClient(row: unknown) {
    return {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    } as never
  }

  it('returns the latest row when present', async () => {
    const row = {
      terms_version: 'v1',
      content_policy_version: 'v1',
      privacy_policy_version: 'v1',
    }
    const supabase = mockClient(row)
    await expect(loadLatestConsent(supabase, 'uid-1')).resolves.toEqual(row)
  })

  it('returns null when no row exists', async () => {
    const supabase = mockClient(null)
    await expect(loadLatestConsent(supabase, 'uid-1')).resolves.toBeNull()
  })

  it('returns null on supabase error (fail-closed for redirect)', async () => {
    const supabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'boom' } }),
    } as never
    await expect(loadLatestConsent(supabase, 'uid-1')).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
rtk proxy pnpm test tests/unit/consent-guard.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/consent/consent-guard.ts`**

```ts
/**
 * Issue #57 — Consent-guard primitives.
 *
 * Pure decision (`decideConsentRedirect`) + thin Supabase read
 * (`loadLatestConsent`). Pages and API guards compose these.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  staleConsentDocs,
  type LegalDoc,
  type StoredConsentVersions,
} from '@/lib/legal/versions'

export type ConsentNeed = 'first' | 'update' | null

export interface ConsentDecision {
  needs: ConsentNeed
  staleDocs: LegalDoc[]
}

/**
 * Map a stored consent row to the redirect-required state.
 *
 * - null row → needs 'first', all three docs stale
 * - exact match → needs null, empty staleDocs
 * - any mismatch → needs 'update', list of stale docs
 *
 * Pure; safe everywhere.
 */
export function decideConsentRedirect(
  stored: StoredConsentVersions | null,
): ConsentDecision {
  const staleDocs = staleConsentDocs(stored)
  if (staleDocs.length === 0) return { needs: null, staleDocs: [] }
  return {
    needs: stored === null ? 'first' : 'update',
    staleDocs,
  }
}

/**
 * Read the latest consent row for `userId`. Returns null on no-row OR
 * any Supabase error — fail-closed; the caller will redirect to
 * /auth/consent and the user can retry from a clean state.
 */
export async function loadLatestConsent(
  supabase: SupabaseClient,
  userId: string,
): Promise<StoredConsentVersions | null> {
  try {
    const { data, error } = await supabase
      .from('consents')
      .select('terms_version, content_policy_version, privacy_policy_version')
      .eq('user_id', userId)
      .order('consented_at', { ascending: false })
      .limit(1)
      .maybeSingle<StoredConsentVersions>()
    if (error) {
      console.error('[consent-guard] loadLatestConsent error:', error.message)
      return null
    }
    return data
  } catch (err) {
    console.error('[consent-guard] loadLatestConsent threw:', err)
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
rtk proxy pnpm test tests/unit/consent-guard.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/consent/consent-guard.ts tests/unit/consent-guard.test.ts
git commit -m "feat(consent): add consent-guard primitives (#57)

decideConsentRedirect maps a stored row to redirect state; loadLatestConsent
reads the hot lookup with fail-closed posture. Pages and API guards
compose these — no I/O coupling, easy to unit test."
```

---

## Task 4: Consent server actions (record + decline)

**Files:**
- Create: `lib/consent/server-actions.ts`
- Create: `tests/unit/consent-server-action.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/unit/consent-server-action.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock next/headers BEFORE importing the module under test.
vi.mock('next/headers', () => ({
  headers: async () => new Map<string, string>([
    ['x-forwarded-for', '203.0.113.5'],
    ['user-agent', 'vitest/1.0'],
  ]),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ user: { id: 'uid-1' } })),
}))

const insertSpy = vi.fn()
const deleteSpy = vi.fn()
const sessionsDeleteSpy = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => {
        insertSpy(table, row)
        return Promise.resolve({ data: row, error: null })
      },
      delete: () => ({
        eq: (col: string, val: string) => {
          deleteSpy(table, col, val)
          return Promise.resolve({ error: null })
        },
      }),
    }),
    schema: (s: string) => ({
      from: (table: string) => ({
        delete: () => ({
          eq: (col: string, val: string) => {
            sessionsDeleteSpy(s, table, col, val)
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }),
  }),
}))

beforeEach(() => {
  insertSpy.mockClear()
  deleteSpy.mockClear()
  sessionsDeleteSpy.mockClear()
})

describe('recordConsent', () => {
  it('rejects when age is not confirmed', async () => {
    const { recordConsent } = await import('@/lib/consent/server-actions')
    const fd = new FormData()
    fd.set('age', 'false')
    fd.set('terms', 'true')
    fd.set('content_policy', 'true')
    fd.set('privacy_policy', 'true')
    await expect(recordConsent(fd)).rejects.toThrow(/REDIRECT:\/auth\/consent\?error=/)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects when terms is not confirmed', async () => {
    const { recordConsent } = await import('@/lib/consent/server-actions')
    const fd = new FormData()
    fd.set('age', 'true')
    fd.set('terms', 'false')
    fd.set('content_policy', 'true')
    fd.set('privacy_policy', 'true')
    await expect(recordConsent(fd)).rejects.toThrow(/REDIRECT:\/auth\/consent\?error=/)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('inserts a consent row with current versions when all 4 are ticked', async () => {
    const { recordConsent } = await import('@/lib/consent/server-actions')
    const fd = new FormData()
    fd.set('age', 'true')
    fd.set('terms', 'true')
    fd.set('content_policy', 'true')
    fd.set('privacy_policy', 'true')
    await expect(recordConsent(fd)).rejects.toThrow(/REDIRECT:\//)
    expect(insertSpy).toHaveBeenCalledOnce()
    const [table, row] = insertSpy.mock.calls[0]
    expect(table).toBe('consents')
    expect(row).toMatchObject({
      user_id: 'uid-1',
      age_confirmed: true,
      terms_version: expect.any(String),
      content_policy_version: expect.any(String),
      privacy_policy_version: expect.any(String),
      ip_address: '203.0.113.5',
      user_agent: 'vitest/1.0',
    })
  })
})

describe('declineConsent', () => {
  it('deletes sessions before deleting the user', async () => {
    const { declineConsent } = await import('@/lib/consent/server-actions')
    await expect(declineConsent()).rejects.toThrow(/REDIRECT:\/auth\/consent-declined/)

    // Session delete must complete before user delete is issued.
    const sessionsCallOrder = sessionsDeleteSpy.mock.invocationCallOrder[0]
    const usersCallOrder = sessionsDeleteSpy.mock.invocationCallOrder.find(
      (_, i) => sessionsDeleteSpy.mock.calls[i][1] === 'users',
    )
    expect(sessionsCallOrder).toBeDefined()
    expect(usersCallOrder).toBeDefined()
    expect(sessionsCallOrder! < usersCallOrder!).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
rtk proxy pnpm test tests/unit/consent-server-action.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/consent/server-actions.ts`**

```ts
'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'

/**
 * Record consent for the current session user.
 *
 * Server-side validation: all four checkboxes must be 'true'. The version
 * triple is read from LEGAL_VERSIONS at submission time (NOT carried
 * through the form), so a mid-session bump is recorded against the live
 * docs.
 */
export async function recordConsent(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  const age = formData.get('age') === 'true'
  const terms = formData.get('terms') === 'true'
  const contentPolicy = formData.get('content_policy') === 'true'
  const privacyPolicy = formData.get('privacy_policy') === 'true'

  if (!age || !terms || !contentPolicy || !privacyPolicy) {
    redirect('/auth/consent?error=all_required')
  }

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = h.get('user-agent') ?? null

  const supabase = createAdminSupabaseClient()
  const { error } = await supabase.from('consents').insert({
    user_id: session.user.id,
    age_confirmed: true,
    terms_version: LEGAL_VERSIONS.terms,
    content_policy_version: LEGAL_VERSIONS.content_policy,
    privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
    ip_address: ip,
    user_agent: ua,
  })

  if (error && !/duplicate key/i.test(error.message)) {
    console.error('[consent] recordConsent insert failed:', error.message)
    redirect('/auth/consent?error=write_failed')
  }

  redirect('/')
}

/**
 * Decline consent — cancels signup.
 *
 * Order matters: delete next_auth.sessions for this user FIRST so the
 * live cookie can't act against a half-deleted user. CASCADE on
 * next_auth.users removes the accounts row and the public.users row.
 */
export async function declineConsent(): Promise<void> {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }
  const userId = session.user.id
  const supabase = createAdminSupabaseClient()

  // 1. Revoke all sessions for this user first.
  const { error: sessErr } = await supabase
    .schema('next_auth')
    .from('sessions')
    .delete()
    .eq('userId', userId)
  if (sessErr) {
    console.error('[consent] decline: session delete failed:', sessErr.message)
  }

  // 2. Delete the user row. CASCADE handles accounts + public.users.
  const { error: userErr } = await supabase
    .schema('next_auth')
    .from('users')
    .delete()
    .eq('id', userId)
  if (userErr) {
    console.error('[consent] decline: user delete failed:', userErr.message)
  }

  redirect('/auth/consent-declined')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
rtk proxy pnpm test tests/unit/consent-server-action.test.ts
```

Expected: tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/consent/server-actions.ts tests/unit/consent-server-action.test.ts
git commit -m "feat(consent): add record + decline server actions (#57)

recordConsent reads LEGAL_VERSIONS at submission time so a mid-session
bump is honest. declineConsent deletes next_auth.sessions BEFORE
next_auth.users — sessions-first prevents the live cookie from acting
against a half-deleted user; CASCADE handles accounts + public.users."
```

---

## Task 5: `/auth/consent` page + `ConsentForm`

**Files:**
- Create: `app/auth/consent/page.tsx`
- Create: `app/auth/consent/ConsentForm.tsx`

- [ ] **Step 1: Implement the page (server component)**

`app/auth/consent/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadLatestConsent, decideConsentRedirect } from '@/lib/consent/consent-guard'
import { ConsentForm } from './ConsentForm'

export const metadata: Metadata = {
  title: 'Review and consent',
  robots: { index: false, follow: false },
}

interface PageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function ConsentPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  const supabase = createAdminSupabaseClient()
  const stored = await loadLatestConsent(supabase, session.user.id)
  const decision = decideConsentRedirect(stored)

  if (decision.needs === null) {
    // Already fully consented — page is navigable but pointless. Send home.
    redirect('/')
  }

  const sp = await searchParams
  const error = sp.error ?? null

  return (
    <main id="main-content" className="settings-page">
      <h1 className="settings-heading">Before you continue</h1>
      <p className="settings-help">
        {decision.needs === 'first'
          ? 'To use agentlab.in, please confirm the following:'
          : 'We updated our policies. Please review and confirm:'}
      </p>
      {error === 'all_required' && (
        <p role="alert" className="settings-error">
          All four boxes are required.
        </p>
      )}
      {error === 'write_failed' && (
        <p role="alert" className="settings-error">
          Something went wrong recording your consent. Please try again.
        </p>
      )}
      <ConsentForm />
    </main>
  )
}
```

- [ ] **Step 2: Implement the client form**

`app/auth/consent/ConsentForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { recordConsent, declineConsent } from '@/lib/consent/server-actions'

export function ConsentForm() {
  const [age, setAge] = useState(false)
  const [terms, setTerms] = useState(false)
  const [contentPolicy, setContentPolicy] = useState(false)
  const [privacyPolicy, setPrivacyPolicy] = useState(false)

  const allChecked = age && terms && contentPolicy && privacyPolicy

  return (
    <form className="consent-form">
      <fieldset className="consent-fieldset">
        <legend className="visually-hidden">Required confirmations</legend>

        <label className="consent-checkbox">
          <input
            type="checkbox"
            name="age"
            checked={age}
            onChange={(e) => setAge(e.target.checked)}
            required
          />
          <span>I confirm I am 18 years of age or older.</span>
        </label>

        <label className="consent-checkbox">
          <input
            type="checkbox"
            name="terms"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            required
          />
          <span>
            I have read and agree to the{' '}
            <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a>.
          </span>
        </label>

        <label className="consent-checkbox">
          <input
            type="checkbox"
            name="content_policy"
            checked={contentPolicy}
            onChange={(e) => setContentPolicy(e.target.checked)}
            required
          />
          <span>
            I have read and agree to the{' '}
            <a href="/policy" target="_blank" rel="noreferrer">Content Policy</a>.
          </span>
        </label>

        <label className="consent-checkbox">
          <input
            type="checkbox"
            name="privacy_policy"
            checked={privacyPolicy}
            onChange={(e) => setPrivacyPolicy(e.target.checked)}
            required
          />
          <span>
            I have read and agree to the{' '}
            <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
          </span>
        </label>
      </fieldset>

      <div className="consent-actions">
        <button
          type="submit"
          formAction={async (fd) => {
            // Force the checked booleans into the form data (controlled inputs
            // don't serialize unchecked boxes by default).
            fd.set('age', String(age))
            fd.set('terms', String(terms))
            fd.set('content_policy', String(contentPolicy))
            fd.set('privacy_policy', String(privacyPolicy))
            await recordConsent(fd)
          }}
          disabled={!allChecked}
          className="settings-button"
        >
          Agree and continue
        </button>
        <button
          type="submit"
          formAction={async () => {
            await declineConsent()
          }}
          className="settings-button settings-button--ghost"
        >
          Decline
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Manually verify the route renders (typecheck only — full e2e in Task 10)**

```bash
rtk proxy pnpm typecheck
```

Expected: no TS errors.

- [ ] **Step 4: Commit**

```bash
git add app/auth/consent/page.tsx app/auth/consent/ConsentForm.tsx
git commit -m "feat(consent): add /auth/consent page and ConsentForm (#57)

Server component reads consent state and chooses the first-visit vs.
updated copy. Client form holds the 4 checkbox states, disables submit
until all four are ticked, and serializes the booleans explicitly so an
unchecked box becomes 'false' rather than absent."
```

---

## Task 6: `/auth/consent-declined` page

**Files:**
- Create: `app/auth/consent-declined/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Consent declined',
  robots: { index: false, follow: false },
}

export default function ConsentDeclinedPage() {
  return (
    <main id="main-content" className="settings-page">
      <h1 className="settings-heading">You can&rsquo;t use agentlab.in without agreeing</h1>
      <p>
        We require explicit consent to our{' '}
        <a href="/terms">Terms of Service</a>,{' '}
        <a href="/policy">Content Policy</a>, and{' '}
        <a href="/privacy">Privacy Policy</a> — and confirmation that you
        are 18 or older — before any account can be created. Your in-progress
        signup has been cancelled and no account data was saved.
      </p>
      <p>
        If you change your mind,{' '}
        <a href="/auth/signin">sign in again</a> and complete the consent step.
      </p>
    </main>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
rtk proxy pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add app/auth/consent-declined/page.tsx
git commit -m "feat(consent): add /auth/consent-declined terminal page (#57)

Honest framing for refused signups: explains that consent is required,
confirms no account was saved, links to docs + sign-in."
```

---

## Task 7: Page-level helper + extend `guardMutatingRequest`

**Files:**
- Create: `lib/consent/require-consent.ts`
- Modify: `lib/route-guard.ts`
- Create: `tests/unit/route-guard-consent.test.ts`
- Create: `tests/unit/require-consent.test.ts`

- [ ] **Step 1: Failing tests for `require-consent` page helper**

`tests/unit/require-consent.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))

const loadSpy = vi.fn()
vi.mock('@/lib/consent/consent-guard', async (orig) => {
  const actual = await orig() as Record<string, unknown>
  return { ...actual, loadLatestConsent: loadSpy }
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({}),
}))

describe('requireConsentOrRedirect', () => {
  it('passes through when consent is current', async () => {
    const { requireConsentOrRedirect } = await import('@/lib/consent/require-consent')
    loadSpy.mockResolvedValueOnce({
      terms_version: (await import('@/lib/legal/versions')).LEGAL_VERSIONS.terms,
      content_policy_version: (await import('@/lib/legal/versions')).LEGAL_VERSIONS.content_policy,
      privacy_policy_version: (await import('@/lib/legal/versions')).LEGAL_VERSIONS.privacy_policy,
    })
    await expect(requireConsentOrRedirect('uid-1')).resolves.toBeUndefined()
  })

  it('redirects to /auth/consent when no row exists', async () => {
    const { requireConsentOrRedirect } = await import('@/lib/consent/require-consent')
    loadSpy.mockResolvedValueOnce(null)
    await expect(requireConsentOrRedirect('uid-1')).rejects.toThrow(/REDIRECT:\/auth\/consent/)
  })

  it('redirects when a version is stale', async () => {
    const { requireConsentOrRedirect } = await import('@/lib/consent/require-consent')
    loadSpy.mockResolvedValueOnce({
      terms_version: 'v0',
      content_policy_version: 'v1',
      privacy_policy_version: 'v1',
    })
    await expect(requireConsentOrRedirect('uid-1')).rejects.toThrow(/REDIRECT:\/auth\/consent/)
  })
})
```

- [ ] **Step 2: Implement `lib/consent/require-consent.ts`**

```ts
/**
 * Issue #57 — authed-page helper.
 *
 * Call right after getSession() in any server component that requires
 * a consented user. Pass-through on consent; throws via Next's redirect
 * otherwise (Next treats redirect as a control-flow throw).
 */
import { redirect } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadLatestConsent, decideConsentRedirect } from '@/lib/consent/consent-guard'

export async function requireConsentOrRedirect(userId: string): Promise<void> {
  const supabase = createAdminSupabaseClient()
  const stored = await loadLatestConsent(supabase, userId)
  const decision = decideConsentRedirect(stored)
  if (decision.needs !== null) {
    redirect('/auth/consent')
  }
}
```

- [ ] **Step 3: Failing test for `guardMutatingRequest` consent option**

`tests/unit/route-guard-consent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const loadSpy = vi.fn()
vi.mock('@/lib/consent/consent-guard', async (orig) => {
  const actual = await orig() as Record<string, unknown>
  return { ...actual, loadLatestConsent: loadSpy }
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({}),
}))
vi.mock('@/lib/security/origin-check', () => ({
  isAllowedOrigin: () => true,
}))

beforeEach(() => loadSpy.mockReset())

describe('guardMutatingRequest with requireConsent', () => {
  it('returns 412 when user has no consent row', async () => {
    const { guardMutatingRequest } = await import('@/lib/route-guard')
    loadSpy.mockResolvedValueOnce(null)
    const req = new Request('https://x/y', { method: 'POST', headers: { origin: 'https://x' } })
    const r = await guardMutatingRequest(req, { userId: 'uid-1', requireConsent: true })
    expect(r.failed).toBe(true)
    if (r.failed) {
      expect(r.response.status).toBe(412)
    }
  })

  it('passes when consent is current', async () => {
    const { guardMutatingRequest } = await import('@/lib/route-guard')
    const { LEGAL_VERSIONS } = await import('@/lib/legal/versions')
    loadSpy.mockResolvedValueOnce({
      terms_version: LEGAL_VERSIONS.terms,
      content_policy_version: LEGAL_VERSIONS.content_policy,
      privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
    })
    const req = new Request('https://x/y', { method: 'POST', headers: { origin: 'https://x' } })
    const r = await guardMutatingRequest(req, { userId: 'uid-1', requireConsent: true })
    expect(r.failed).toBe(false)
  })

  it('skips the consent check when requireConsent is false', async () => {
    const { guardMutatingRequest } = await import('@/lib/route-guard')
    const req = new Request('https://x/y', { method: 'POST', headers: { origin: 'https://x' } })
    const r = await guardMutatingRequest(req, { userId: 'uid-1', requireConsent: false })
    expect(r.failed).toBe(false)
    expect(loadSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
rtk proxy pnpm test tests/unit/require-consent.test.ts tests/unit/route-guard-consent.test.ts
```

Expected: FAIL.

- [ ] **Step 5: Extend `lib/route-guard.ts`**

Modify the existing `GuardOptions` interface to add `requireConsent?: boolean` and add a consent check block AFTER origin + rate-limit but BEFORE returning ok:

```ts
import { decideConsentRedirect, loadLatestConsent } from '@/lib/consent/consent-guard'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export interface GuardOptions {
  bucket?: RateLimitBucket
  userId?: string | null
  skipOrigin?: boolean
  /**
   * When true and `userId` is provided, also require the user's consent
   * versions match LEGAL_VERSIONS. Returns 412 on mismatch.
   *
   * Default: false. Each handler opts in explicitly. /api/auth/* and
   * /api/health do NOT opt in (callback flow must not loop).
   */
  requireConsent?: boolean
}
```

Add after the rate-limit block:

```ts
if (opts.requireConsent && opts.userId) {
  try {
    const supabase = createAdminSupabaseClient()
    const stored = await loadLatestConsent(supabase, opts.userId)
    const decision = decideConsentRedirect(stored)
    if (decision.needs !== null) {
      return {
        failed: true,
        response: json(412, { error: 'consent_required', stale: decision.staleDocs }),
      }
    }
  } catch (err) {
    console.warn(
      `[route-guard] consent check threw: ${err instanceof Error ? err.message : 'unknown'}`,
    )
    // Fail-CLOSED on a consent-check error — a writer hitting an unknown
    // consent state should not bypass the gate.
    return {
      failed: true,
      response: json(412, { error: 'consent_required' }),
    }
  }
}
```

- [ ] **Step 6: Verify tests pass**

```bash
rtk proxy pnpm test tests/unit/require-consent.test.ts tests/unit/route-guard-consent.test.ts tests/unit/route-guard.test.ts
```

Expected: all PASS (including the existing route-guard tests).

- [ ] **Step 7: Commit**

```bash
git add lib/consent/require-consent.ts lib/route-guard.ts tests/unit/require-consent.test.ts tests/unit/route-guard-consent.test.ts
git commit -m "feat(consent): page helper + guardMutatingRequest opt-in (#57)

requireConsentOrRedirect for server-component callsites; route-guard
gains a requireConsent option that 412s on stale users. Both compose
the same consent-guard primitives — single source of truth for the
redirect decision."
```

---

## Task 8: Wire consent enforcement into authed surfaces

**Files (modify):**
- `app/write/page.tsx` (and any sub-routes)
- `app/settings/profile/page.tsx`
- Any `/api/posts`, `/api/comments`, `/api/uploads`, `/api/orgs` mutating handlers (audit and add `requireConsent: true`)

The full list of authed surfaces:

- [ ] **Step 1: Find authed page entry points**

```bash
rtk proxy grep -lR "await getSession" app/ | sort -u
```

For each one that represents an authed action (not a public profile/post read), add `requireConsentOrRedirect(session.user.id)` right after the `getSession()` call.

Exempt: `app/auth/consent/page.tsx`, `app/auth/consent-declined/page.tsx`, `app/auth/signin/page.tsx`, `app/auth/blocked/page.tsx`.

For each modified page, the diff is mechanical:

```tsx
import { requireConsentOrRedirect } from '@/lib/consent/require-consent'
// ...
const session = await getSession()
if (!session?.user?.id) redirect('/auth/signin')
await requireConsentOrRedirect(session.user.id)
```

- [ ] **Step 2: Find mutating API handlers**

```bash
rtk proxy grep -lR "guardMutatingRequest" app/api/ | sort -u
```

For each one, add `requireConsent: true` to the options object. Exception: `app/api/auth/**` and `app/api/health/**` — those stay without the option.

- [ ] **Step 3: Typecheck + run full unit suite**

```bash
rtk proxy pnpm typecheck && rtk proxy pnpm test
```

Expected: PASS. If a test fails because a fixture didn't seed a consent row, update the fixture (see Task 10 for the E2E helper that does this consistently).

- [ ] **Step 4: Commit**

```bash
git add app/ # only the modified files
git commit -m "feat(consent): gate authed pages and mutating APIs (#57)

Every authed page calls requireConsentOrRedirect after getSession;
every mutating API handler opts into the route-guard's requireConsent
check. /api/auth/* and /api/health remain exempt so the OAuth callback
can run without a redirect loop."
```

---

## Task 9: `/settings/profile` consent snapshot

**Files:**
- Create: `components/settings/ConsentSnapshotSection.tsx`
- Modify: `app/settings/profile/page.tsx`

- [ ] **Step 1: Implement `ConsentSnapshotSection`**

```tsx
import { LEGAL_VERSIONS } from '@/lib/legal/versions'

interface Props {
  consent: {
    consented_at: string
    terms_version: string
    content_policy_version: string
    privacy_policy_version: string
  } | null
}

export function ConsentSnapshotSection({ consent }: Props) {
  return (
    <section className="settings-section">
      <h2 className="settings-subheading">Consent</h2>
      {consent ? (
        <p className="settings-help">
          You agreed to Terms {consent.terms_version}, Content Policy{' '}
          {consent.content_policy_version}, and Privacy Policy{' '}
          {consent.privacy_policy_version} on{' '}
          <time dateTime={consent.consented_at}>
            {new Date(consent.consented_at).toISOString().slice(0, 10)}
          </time>
          .
        </p>
      ) : (
        <p className="settings-help">No consent on record.</p>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Wire into `/settings/profile`**

Add the read alongside the existing `data` query in `app/settings/profile/page.tsx`:

```tsx
const { data: consentRow } = await admin
  .from('consents')
  .select('consented_at, terms_version, content_policy_version, privacy_policy_version')
  .eq('user_id', session.user.id)
  .order('consented_at', { ascending: false })
  .limit(1)
  .maybeSingle<{
    consented_at: string
    terms_version: string
    content_policy_version: string
    privacy_policy_version: string
  }>()
```

Render `<ConsentSnapshotSection consent={consentRow ?? null} />` between `<OrgsListSection>` and `<DeleteAccountSection>`.

- [ ] **Step 3: Typecheck**

```bash
rtk proxy pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add components/settings/ConsentSnapshotSection.tsx app/settings/profile/page.tsx
git commit -m "feat(consent): show consent snapshot on /settings/profile (#57)

Small subsection above the danger zone with the user's recorded
versions + timestamp. Pulls the latest consent row via the same RLS
self-read policy."
```

---

## Task 10: E2E tests

**Files:**
- Create: `tests/e2e/consent-gate.spec.ts`
- Modify: `tests/e2e/a11y.spec.ts`

- [ ] **Step 1: Inspect existing E2E auth shim**

Read `tests/e2e/` to confirm how Playwright tests authenticate (`x-e2e-auth: 1` header, `E2E_TEST_AUTH_USER_ID` env var). The shim returns a synthetic session; the DB still needs a `next_auth.users` row to exist for the consent FK to land. Use the existing fixture helper if present, otherwise insert directly via the admin client in `beforeEach`.

- [ ] **Step 2: Write the consent-gate spec**

```ts
import { test, expect } from '@playwright/test'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const E2E_UID = process.env.E2E_TEST_AUTH_USER_ID!

async function clearConsents(userId: string) {
  const admin = createAdminSupabaseClient()
  await admin.from('consents').delete().eq('user_id', userId)
}

async function seedConsent(userId: string, versions = {
  terms_version: 'v1',
  content_policy_version: 'v1',
  privacy_policy_version: 'v1',
}) {
  const admin = createAdminSupabaseClient()
  await admin.from('consents').insert({
    user_id: userId,
    age_confirmed: true,
    ...versions,
  })
}

test.describe('Consent gate (#57)', () => {
  test.beforeEach(async () => {
    await clearConsents(E2E_UID)
  })

  test('first-time signup is gated, all four boxes required', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-e2e-auth': '1' })

    await page.goto('/write')
    await expect(page).toHaveURL(/\/auth\/consent$/)

    const submit = page.getByRole('button', { name: /agree and continue/i })
    await expect(submit).toBeDisabled()

    await page.getByLabel(/18 years of age/i).check()
    await expect(submit).toBeDisabled()
    await page.getByLabel(/Terms of Service/i).check()
    await expect(submit).toBeDisabled()
    await page.getByLabel(/Content Policy/i).check()
    await expect(submit).toBeDisabled()
    await page.getByLabel(/Privacy Policy/i).check()
    await expect(submit).toBeEnabled()

    await submit.click()
    await expect(page).toHaveURL(/\/$|\/feed/)
  })

  test('decline cancels signup and lands on consent-declined', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-e2e-auth': '1' })
    await page.goto('/auth/consent')
    await page.getByRole('button', { name: /decline/i }).click()
    await expect(page).toHaveURL(/\/auth\/consent-declined$/)

    const admin = createAdminSupabaseClient()
    const { data } = await admin.schema('next_auth').from('users').select('id').eq('id', E2E_UID)
    expect(data?.length ?? 0).toBe(0)
  })

  test('existing user with no consent row is grandfathered into prompt', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-e2e-auth': '1' })
    await page.goto('/settings/profile')
    await expect(page).toHaveURL(/\/auth\/consent$/)
    await expect(page.getByText(/updated our policies/i)).toBeVisible()
  })

  test('version bump re-prompts a previously consented user', async ({ page }) => {
    await seedConsent(E2E_UID, {
      terms_version: 'v0', // stale
      content_policy_version: 'v1',
      privacy_policy_version: 'v1',
    })
    await page.setExtraHTTPHeaders({ 'x-e2e-auth': '1' })
    await page.goto('/write')
    await expect(page).toHaveURL(/\/auth\/consent$/)
  })

  test('server rejects a forged POST missing a box', async ({ request }) => {
    // Hit the server action endpoint via the form's action URL. In Next 16
    // server actions are dispatched via a POST to the page itself with a
    // Next-Action header — easier to test the rejection by submitting the
    // form with one box unchecked.
    await request.post('/auth/consent', {
      headers: { 'x-e2e-auth': '1', 'content-type': 'application/x-www-form-urlencoded' },
      data: 'age=true&terms=true&content_policy=true&privacy_policy=false',
    })
    // The action redirects with ?error=all_required; we just verify the
    // consent row was NOT written.
    const admin = createAdminSupabaseClient()
    const { count } = await admin
      .from('consents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', E2E_UID)
    expect(count ?? 0).toBe(0)
  })
})
```

- [ ] **Step 3: Add `/auth/consent` to the a11y sweep**

In `tests/e2e/a11y.spec.ts`, add `/auth/consent` and `/auth/consent-declined` to the route list.

- [ ] **Step 4: Run E2E**

```bash
rtk proxy pnpm e2e tests/e2e/consent-gate.spec.ts
rtk proxy pnpm a11y
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/consent-gate.spec.ts tests/e2e/a11y.spec.ts
git commit -m "test(consent): E2E + a11y coverage for the consent gate (#57)

First-time happy path; decline cancels and wipes the user row;
grandfathered user redirected with banner; version bump re-prompts;
forged POST omitting one box does not write a row. Axe sweeps both
new routes."
```

---

## Task 11: Bump legal docs to v1 + reference the consent mechanism

**Files (modify):**
- `legal/terms-of-service.md`
- `legal/content-policy.md`
- `legal/privacy-policy.md`

- [ ] **Step 1: Bump each doc**

For each of the three files:

1. Add a `**Version:** v1` line directly under `**Effective Date:** …`.
2. Insert the consent reference paragraph as described in the spec under "Legal doc updates".

Specifically:

- `legal/terms-of-service.md` §3.1 — append: "We record this consent in our database as required by DPDP Act 2023; the record captures a timestamp, your IP address, your user-agent, and the version of each doc you agreed to (see Privacy Policy §2.X for retention)."
- `legal/privacy-policy.md` §2 — add a sub-bullet for the `public.consents` row fields.
- `legal/content-policy.md` §1 — add a sentence noting that violations of this Policy (which you agreed to at signup) can lead to ban.

DMCA and Grievance docs stay untouched.

- [ ] **Step 2: Verify legal pages still render**

```bash
rtk proxy pnpm test tests/unit/migration-0007.test.ts || true   # smoke any legal-related tests
rtk proxy pnpm build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add legal/terms-of-service.md legal/content-policy.md legal/privacy-policy.md
git commit -m "docs(legal): bump Terms/Content/Privacy to v1 and reference consent (#57)

Each doc gains a Version line under the effective date and a short
paragraph pointing at the consent step. DMCA + Grievance left as
operator notices (not user contracts)."
```

---

## Task 12: Full verification + push + PR

- [ ] **Step 1: Run all gates via rtk proxy**

```bash
rtk proxy pnpm typecheck
rtk proxy pnpm lint
rtk proxy pnpm test
rtk proxy pnpm build
rtk proxy pnpm e2e
```

All must be green. Fix any failures and re-run.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/consent-gate
```

- [ ] **Step 3: Open PR against `develop`**

```bash
gh pr create --base develop --title "feat(consent): consent gate at signup — 18+ + Terms + Content Policy + Privacy Policy (#57)" --body "$(cat <<'EOF'
## Summary
- Adds a `/auth/consent` gate that captures explicit consent to 18+ + Terms + Content Policy + Privacy Policy before any first-time signup can proceed.
- New `public.consents` table (append-only audit log) + `lib/legal/versions.ts` constants; bumping a version triggers a re-prompt on every user's next authed request.
- Refuse path deletes `next_auth.sessions` before `next_auth.users` so the live cookie can't act against a half-deleted user. CASCADE handles accounts + `public.users`.
- Existing users are soft-grandfathered: their next authed request redirects to `/auth/consent` with the "updated our policies" banner.
- Enforcement: page-level `requireConsentOrRedirect` helper for server components; `guardMutatingRequest` gains a `requireConsent` opt-in for mutating APIs (412 on stale, exempting `/api/auth/*` and `/api/health` so the OAuth callback doesn't loop).
- `/settings/profile` shows a small consent snapshot above the danger zone.
- Terms / Content Policy / Privacy Policy bumped to v1 with consent-mechanism references.

## Resolved decisions (surfaced in the brief)
- **Refuse-consent cleanup ordering:** sessions deleted first, then user row (CASCADE). Live cookie can't outrun the user delete.
- **Middleware scope on API calls:** yes, via `guardMutatingRequest({ requireConsent: true })`; `/api/auth/*` and `/api/health` exempt.
- **Mid-signup version bump:** the server action re-reads `LEGAL_VERSIONS` at submission time. The consent row reflects whichever versions the docs currently show — never stale-from-render.

## Test plan
- [x] `rtk proxy pnpm typecheck`
- [x] `rtk proxy pnpm lint`
- [x] `rtk proxy pnpm test` (unit: migration shape, versions, consent-guard, server actions, route-guard consent opt-in, require-consent helper)
- [x] `rtk proxy pnpm build`
- [x] `rtk proxy pnpm e2e tests/e2e/consent-gate.spec.ts` (first-time happy path; decline cancels and wipes the user row; grandfathered user redirected; version bump re-prompts; forged POST does not write)
- [x] `rtk proxy pnpm a11y` (Axe sweep over `/auth/consent` and `/auth/consent-declined`)

Closes #57.
EOF
)"
```

- [ ] **Step 4: Report to AO**

```bash
ao report pr-created --pr-url $(gh pr view --json url -q .url)
```

---

## Self-review

- [x] Each spec section maps to a task: migration (T1), versions (T2), guard primitives (T3), server actions (T4), page + form (T5), declined page (T6), enforcement (T7+T8), settings visibility (T9), tests (T10), legal doc bumps (T11), gates + PR (T12).
- [x] No "TODO" or "TBD" markers.
- [x] Function and table names consistent (`loadLatestConsent`, `decideConsentRedirect`, `requireConsentOrRedirect`, `recordConsent`, `declineConsent`, `staleConsentDocs`, `LEGAL_VERSIONS`, `public.consents`).
- [x] Every test step has full code; every command shows what to run.
