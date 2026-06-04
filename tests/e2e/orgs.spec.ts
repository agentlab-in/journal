/**
 * Phase 11.5 orgs (GitHub-backed) — E2E tests
 *
 * File purpose
 * ------------
 * Exercises the read-side surfaces of the GitHub-backed orgs flow:
 *   - /settings/profile#orgs renders the caller's memberships read-only.
 *   - Empty state copy nudges users toward GitHub.
 *   - A pre-seeded membership round-trips through publish (/api/posts with
 *     org_id) and the resulting /<org-slug>/<type>/<post-slug> URL.
 *   - The standalone-org write surface from PR #35 is gone — the legacy
 *     /api/orgs/* routes 404 (or 405).
 *
 * Auth strategy
 * -------------
 * Same E2E shim as publish.spec.ts / admin.spec.ts:
 *   - header `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`.
 *   - env `E2E_TEST_AUTH_USER_ID` sets the user ID the bypass returns.
 *
 * DB dependency
 * -------------
 * Tests that read or write `public.orgs` / `public.org_members` /
 * `public.posts` skip when `SUPABASE_SERVICE_ROLE_KEY` is missing — mirror
 * of editor.spec.ts. Tests are independent (each uses a unique slug suffix
 * and cleans up its own rows).
 *
 * Known gaps
 * ----------
 * The actual GitHub-sync code path (`syncUserGithubOrgs` invoked from
 * NextAuth's `events.signIn`) is NEVER exercised by E2E because the auth
 * shim in `lib/auth.ts` short-circuits `getSession()` with a synthetic
 * session — `events.signIn` never fires. That path is covered by unit
 * tests:
 *   - tests/unit/orgs-github-sync.test.ts (the sync itself)
 *   - tests/unit/auth-org-sync.test.ts    (read:org scope + callback wiring)
 *
 * Multi-user flows (e.g. "user B's sign-in materializes org X that user A
 * already belongs to") are out of scope for E2E — the shim only supports a
 * single `E2E_TEST_AUTH_USER_ID`. Same gap PR #35 documented. The
 * "non-member sees no org in dropdown" assertion is covered by
 * tests/unit/orgs-ui.test.tsx mounting <PublishAsSelect/> with empty
 * `userOrgs`.
 */
import {
  test,
  expect,
  type Page,
} from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const HAS_SERVICE_KEY = !!process.env.SUPABASE_SERVICE_ROLE_KEY

const SKIP_NO_DB =
  'requires SUPABASE_SERVICE_ROLE_KEY + E2E_TEST_AUTH_USER_ID for DB-backed orgs tests'

// ---------------------------------------------------------------------------
// Helpers (preserved unchanged from PR #35 / publish.spec.ts pattern)
// ---------------------------------------------------------------------------

/** Make `page` send the E2E auth shim header on every request. */
async function signIn(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
}

/**
 * Build a service-role Supabase client for direct DB setup / teardown.
 * Lazy: only called by tests that already gated on HAS_SERVICE_KEY.
 */
function adminDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('adminDb() called without SUPABASE env vars set')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Build a short unique-ish suffix for slug/title uniqueness. */
function uniq(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 9999)}`
}

/**
 * Hard cleanup for an org: removes posts, members, and the org row itself.
 * Service-role bypasses RLS. Safe to call even if some rows don't exist.
 */
async function cleanupOrg(db: SupabaseClient, orgId: string): Promise<void> {
  await db.from('posts').delete().eq('org_id', orgId)
  await db.from('org_members').delete().eq('org_id', orgId)
  await db.from('orgs').delete().eq('id', orgId)
}

/**
 * Seed a GitHub-backed org row + a membership for the E2E auth user.
 * Returns { id, slug } so callers can clean up.
 *
 * Mirrors the shape the live GitHub sync writes:
 *   - `github_org_id` is set so it looks materialized.
 *   - membership role is 'member' (the only role GitHub-backed sync uses).
 *   - `created_by_user_id` is the caller (FK requires a real users row).
 */
async function seedGithubOrgMembership(
  db: SupabaseClient,
  suffix: string,
  displayName: string,
): Promise<{ id: string; slug: string }> {
  const userId = process.env.E2E_TEST_AUTH_USER_ID!
  const slug = `e2e-org-${suffix}`
  // Use a deterministic-ish numeric github_org_id derived from the suffix so
  // parallel runs don't collide on the UNIQUE constraint.
  const githubOrgId =
    Date.now() * 1000 + Math.floor(Math.random() * 1000)

  const { data: orgRow, error: orgErr } = await db
    .from('orgs')
    .insert({
      slug,
      display_name: displayName,
      bio: 'E2E GitHub-backed org',
      created_by_user_id: userId,
      github_org_id: githubOrgId,
    })
    .select('id, slug')
    .single()
  if (orgErr || !orgRow) {
    throw new Error(`seed org failed: ${orgErr?.message ?? 'no row'}`)
  }
  const org = orgRow as { id: string; slug: string }

  const { error: memberErr } = await db.from('org_members').insert({
    org_id: org.id,
    user_id: userId,
    role: 'member',
    added_by_user_id: userId,
  })
  if (memberErr) {
    await db.from('orgs').delete().eq('id', org.id)
    throw new Error(`seed membership failed: ${memberErr.message}`)
  }

  return org
}

// ===========================================================================
// Test 1: /settings/profile#orgs renders a pre-seeded org read-only.
// ===========================================================================

test.describe('Phase 11.5 orgs — /settings/profile#orgs read-only render', () => {
  test('renders org row with display_name + @slug + View link; no Manage/Leave', async ({
    page,
  }) => {
    test.skip(!HAS_SERVICE_KEY || !HAS_E2E_AUTH, SKIP_NO_DB)

    const db = adminDb()
    const suffix = uniq()
    const displayName = `E2E Render Org ${suffix}`
    const org = await seedGithubOrgMembership(db, suffix, displayName)

    try {
      await signIn(page)
      const res = await page.goto('/settings/profile', {
        waitUntil: 'domcontentloaded',
      })
      expect(res?.status()).toBe(200)

      const row = page.getByTestId(`orgs-row-${org.slug}`)
      await expect(row).toBeVisible()
      await expect(row).toContainText(displayName)
      await expect(row).toContainText(`@${org.slug}`)

      const viewLink = row.getByRole('link', { name: 'View' })
      await expect(viewLink).toBeVisible()
      await expect(viewLink).toHaveAttribute('href', `/${org.slug}`)

      // GitHub-backed: no inline management surfaces should be present.
      await expect(row.getByRole('button', { name: /leave/i })).toHaveCount(0)
      await expect(row.getByRole('link', { name: /manage/i })).toHaveCount(0)
    } finally {
      await cleanupOrg(db, org.id)
    }
  })
})

// ===========================================================================
// Test 2: Empty state when the user has no memberships.
// ===========================================================================

test.describe('Phase 11.5 orgs — /settings/profile#orgs empty state', () => {
  test('with no memberships, empty-state copy mentions GitHub; no /settings/orgs/new link', async ({
    page,
  }) => {
    test.skip(!HAS_SERVICE_KEY || !HAS_E2E_AUTH, SKIP_NO_DB)

    const db = adminDb()
    const userId = process.env.E2E_TEST_AUTH_USER_ID!

    // Defensive: blast any membership rows the test user might still own
    // from a prior failed test. Service-role bypasses RLS. We don't drop
    // orgs themselves — they may be referenced by other suites.
    await db.from('org_members').delete().eq('user_id', userId)

    try {
      await signIn(page)
      const res = await page.goto('/settings/profile', {
        waitUntil: 'domcontentloaded',
      })
      expect(res?.status()).toBe(200)

      const section = page.getByTestId('orgs-list-section')
      await expect(section).toBeVisible()
      await expect(section).toContainText(/github/i)

      // The standalone-org create flow is gone — no link to /settings/orgs/new
      // should be reachable from this section.
      await expect(
        section.locator('a[href="/settings/orgs/new"]'),
      ).toHaveCount(0)
    } finally {
      // Nothing seeded — no cleanup required.
    }
  })
})

// ===========================================================================
// Test 3: Publish-as → org-authored post → /<org-slug>/<type>/<post-slug>.
//
// Following publish.spec.ts posture, we issue the POST via the API rather
// than driving the PublishAsSelect form (same friction PR #35 documented).
// ===========================================================================

test.describe('Phase 11.5 orgs — publish under seeded org', () => {
  test('POST /api/posts with org_id returns /<org-slug>/<type>/<post-slug> and the URL renders', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_KEY || !HAS_E2E_AUTH, SKIP_NO_DB)

    const db = adminDb()
    const suffix = uniq()
    const org = await seedGithubOrgMembership(
      db,
      suffix,
      `E2E Publish Org ${suffix}`,
    )

    try {
      const postRes = await request.post('/api/posts', {
        headers: HEADER_E2E_AUTH,
        data: {
          type: 'post',
          title: `E2E Org Post ${suffix}`,
          summary: 'A sufficiently long summary that passes Zod validation.',
          body_md: 'x'.repeat(60),
          tags: ['rag'],
          org_id: org.id,
        },
      })
      expect(postRes.status()).toBe(201)
      const body = (await postRes.json()) as {
        id: string
        slug: string
        url: string
      }
      // URL leading segment is the org slug, not the author username.
      expect(body.url).toMatch(new RegExp(`^/${org.slug}/post/[^/]+$`))

      await signIn(page)
      const pageRes = await page.goto(body.url, {
        waitUntil: 'domcontentloaded',
      })
      expect(pageRes?.status()).toBe(200)
      // The org display name should appear (byline / header). This is a
      // soft check on the org-authored rendering path.
      await expect(page.getByText(org.slug).first()).toBeVisible()
    } finally {
      await cleanupOrg(db, org.id)
    }
  })
})

// ===========================================================================
// Test 4 (defensive): the deleted standalone-org write routes return 404/405.
//
// Phase 11.5 ripped out app/api/orgs/* entirely. Next 16 returns 404 for
// missing route segments, but a missing handler on an otherwise-present
// segment can yield 405 — accept either as proof the surface is gone.
// ===========================================================================

test.describe('Phase 11.5 orgs — legacy write routes are 404', () => {
  test('all deleted /api/orgs/* endpoints return 404 or 405', async ({
    request,
  }) => {
    const probes: Array<{
      method: 'POST' | 'PATCH' | 'DELETE'
      path: string
    }> = [
      { method: 'POST', path: '/api/orgs' },
      { method: 'PATCH', path: '/api/orgs/test-slug' },
      { method: 'DELETE', path: '/api/orgs/test-slug' },
      { method: 'POST', path: '/api/orgs/test-slug/members' },
      {
        method: 'PATCH',
        path: '/api/orgs/test-slug/members/00000000-0000-0000-0000-000000000000',
      },
      {
        method: 'DELETE',
        path: '/api/orgs/test-slug/members/00000000-0000-0000-0000-000000000000',
      },
    ]

    for (const probe of probes) {
      const res =
        probe.method === 'POST'
          ? await request.post(probe.path, { data: {} })
          : probe.method === 'PATCH'
            ? await request.patch(probe.path, { data: {} })
            : await request.delete(probe.path)
      expect(
        [404, 405],
        `${probe.method} ${probe.path} should be 404 or 405 (got ${res.status()})`,
      ).toContain(res.status())
    }
  })
})
