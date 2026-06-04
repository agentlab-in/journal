/**
 * Phase 12 moderation — E2E tests for /admin surface
 *
 * Auth strategy: same E2E shim as profile.spec.ts / comments.spec.ts.
 *   - header `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`.
 *   - env `E2E_TEST_AUTH_USER_ID` sets the user ID the bypass returns.
 *
 * Admin identification is env-var-based: `ADMIN_GITHUB_LOGINS` (set in the
 * running Next.js server) lists the github logins that are admins.
 * `playwright.config.ts` forwards `ADMIN_GITHUB_LOGINS_FOR_E2E` as
 * `ADMIN_GITHUB_LOGINS` to the dev server. Admin tests are therefore gated on
 * BOTH `E2E_TEST_AUTH_USER_ID` and `ADMIN_GITHUB_LOGINS_FOR_E2E`.
 *
 * To run admin tests locally:
 *   E2E_TEST_AUTH_USER_ID=<your-test-user-uuid> \
 *   ADMIN_GITHUB_LOGINS_FOR_E2E=<github-login-for-that-user> \
 *   pnpm e2e tests/e2e/admin.spec.ts
 *
 * Known gaps — two-user flows are NOT covered here:
 *   - Admin bans a user → that user's next sign-in lands on /auth/blocked?reason=banned
 *   - Admin resolves a report by deleting the reported post
 *
 * Both scenarios require TWO distinct authenticated users. The current E2E
 * shim (`lib/auth.ts` `getSession()`) only supports a single user identified
 * by `E2E_TEST_AUTH_USER_ID`. Implementing two-user coverage would require
 * either a second shim env-var, real OAuth in CI, or a test-only API. This is
 * deferred to a future hardening phase. The underlying logic (`decideBanRedirect`
 * pure function, ban API route) is already covered by unit tests (Task 3 and
 * Task 6 of Phase 12).
 *
 * DB dependency: Tests 3 and 4 require Supabase (create/approve posts/tags).
 * Tests 1 and 2 do NOT require a real DB — they only check auth gating and
 * static page rendering. Tests 1 and 2 are gated only on `HAS_E2E_AUTH` because
 * the `requireAdmin` check short-circuits on missing session (notFound()) before
 * any Supabase call is made. Test 2 (/auth/blocked) calls `createAdminSupabaseClient`
 * for the banned_reason lookup, but the try/catch in the page means it gracefully
 * degrades when credentials are placeholder values.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const HAS_ADMIN_LOGIN = !!process.env.ADMIN_GITHUB_LOGINS_FOR_E2E

const SKIP_NO_AUTH = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'
const SKIP_NO_ADMIN =
  'requires admin env (E2E_TEST_AUTH_USER_ID + ADMIN_GITHUB_LOGINS_FOR_E2E)'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make `page` send the E2E auth shim header on every request. */
async function signIn(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
}

/**
 * Create a post with a unique tag and return { id, slug, url, tagSlug }.
 * The tag slug is derived from the suffix and will be `is_approved=false`
 * until an admin approves it.
 */
async function createPostWithNewTag(
  request: APIRequestContext,
  tagSlug: string,
): Promise<{ id: string; slug: string; url: string }> {
  const suffix = tagSlug.replace(/[^a-z0-9-]/g, '-')
  const res = await request.post('/api/posts', {
    headers: HEADER_E2E_AUTH,
    data: {
      type: 'post' as const,
      title: `E2E Admin Tag Test ${suffix}`,
      summary: 'A sufficiently long summary that passes validation.',
      body_md: 'x'.repeat(60),
      tags: [tagSlug],
    },
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { id: string; slug: string; url: string }
  return body
}

// ---------------------------------------------------------------------------
// Test 1: Non-admin / unauthed → /admin returns 404
// ---------------------------------------------------------------------------

test.describe('Phase 12 moderation — admin gate', () => {
  test('/admin and sub-routes return 404 for unauthenticated visitors', async ({
    page,
  }) => {
    // This test does not need HAS_E2E_AUTH — we are testing the ABSENCE of
    // auth. Without the `x-e2e-auth: 1` header the shim returns null, which
    // means `requireAdmin` calls notFound() before touching Supabase.
    // However, the admin layout's `getSession()` still calls the Supabase
    // adapter indirectly via next-auth, which may throw with placeholder
    // credentials. We therefore gate conservatively on HAS_E2E_AUTH so the
    // test only runs when a real (or at least reachable) Supabase backend is
    // configured.
    test.skip(!HAS_E2E_AUTH, SKIP_NO_AUTH)

    const routes = ['/admin', '/admin/reports', '/admin/tags', '/admin/users', '/admin/audit']

    for (const route of routes) {
      // No x-e2e-auth header — shim is inactive → session is null → requireAdmin → notFound()
      const res = await page.goto(route, { waitUntil: 'domcontentloaded' })
      expect(res?.status(), `expected 404 for ${route}`).toBe(404)
    }
  })
})

// ---------------------------------------------------------------------------
// Test 2: /auth/blocked?reason=banned renders ban copy
// ---------------------------------------------------------------------------

test.describe('Phase 12 moderation — /auth/blocked page', () => {
  test('/auth/blocked?reason=banned (anon visitor) renders generic copy, no specific ban detail', async ({ page }) => {
    // Security audit C2: the banned-reason rendering is bound to caller
    // identity. An anon visitor (no session, or session.username !== login)
    // must see only the generic "not accessible" copy — never the
    // specific "your account has been suspended" / "suspensions are not
    // appealable" lines that confirm a ban to a non-owner.

    const res = await page.goto('/auth/blocked?reason=banned', {
      waitUntil: 'domcontentloaded',
    })
    // The page itself always renders (it's a static-ish page) — 200.
    expect(res?.status()).toBe(200)

    // Heading still says "account suspended" — derived from the URL param,
    // which the visitor already knows.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/account suspended/i)

    // Generic copy that doesn't confirm existence or ban-state.
    await expect(page.getByText(/this account is not accessible/i)).toBeVisible()

    // The pre-C2 owner-only copy must NOT leak to anon visitors.
    await expect(page.getByText(/suspensions are not appealable/i)).toHaveCount(0)
    await expect(page.getByText(/your account has been suspended/i)).toHaveCount(0)
  })

  test('/auth/blocked?reason=banned&login=ghosthandle renders generic copy for non-owners', async ({
    page,
  }) => {
    // Anon visitor probing an arbitrary handle: same generic copy. No
    // confirmation of whether the handle exists or is suspended.
    const res = await page.goto('/auth/blocked?reason=banned&login=ghosthandle', {
      waitUntil: 'domcontentloaded',
    })
    expect(res?.status()).toBe(200)

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/account suspended/i)

    // The login is echoed in the sub-heading (it came from the URL — no leak).
    await expect(page.getByText(/@ghosthandle/)).toBeVisible()

    // Generic copy.
    await expect(page.getByText(/this account is not accessible/i)).toBeVisible()
    await expect(page.getByText(/suspensions are not appealable/i)).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// Test 3: Admin happy path — /admin tab nav loads (gated on admin env)
// ---------------------------------------------------------------------------

test.describe('Phase 12 moderation — admin happy path', () => {
  test('/admin redirects admin to /admin/reports with tab nav visible', async ({
    page,
  }) => {
    test.skip(!HAS_E2E_AUTH || !HAS_ADMIN_LOGIN, SKIP_NO_ADMIN)

    await signIn(page)

    // /admin redirects to /admin/reports (server redirect); Playwright follows.
    const res = await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // All four tab links must be visible in AdminTabs nav.
    const nav = page.getByRole('navigation', { name: 'Admin tabs' })
    await expect(nav.getByRole('link', { name: 'Reports' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Tags' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Audit' })).toBeVisible()
  })

  test('/admin/audit renders without error (table or empty state)', async ({
    page,
  }) => {
    test.skip(!HAS_E2E_AUTH || !HAS_ADMIN_LOGIN, SKIP_NO_ADMIN)

    await signIn(page)

    const res = await page.goto('/admin/audit', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // The page renders either a table (rows exist) or the "No audit records" empty state.
    const tableOrEmpty = page.locator('table, :text("No audit records found.")')
    await expect(tableOrEmpty.first()).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Test 4: Admin approves a tag → tag page becomes accessible
// ---------------------------------------------------------------------------

test.describe('Phase 12 moderation — admin approves a pending tag', () => {
  test('admin can approve a pending tag and the tag page then loads', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH || !HAS_ADMIN_LOGIN, SKIP_NO_ADMIN)

    // Generate a unique tag slug that won't collide with existing tags.
    const tagSlug = `e2e-tag-${Date.now()}`

    // Step 1: Create a post that introduces the new tag (will be is_approved=false).
    await createPostWithNewTag(request, tagSlug)

    // Step 2: Visit /admin/tags as admin and verify the tag row appears.
    await signIn(page)
    const tagsRes = await page.goto('/admin/tags', { waitUntil: 'domcontentloaded' })
    expect(tagsRes?.status()).toBe(200)

    // The tag slug should appear in the pending tags table.
    await expect(page.getByText(tagSlug)).toBeVisible({ timeout: 10_000 })

    // Step 3: Click Approve for that specific tag row.
    // The row is keyed by slug. Find the row containing the slug code element,
    // then click the Approve button within it.
    const tagRow = page.locator('tr').filter({ hasText: tagSlug })
    await tagRow.getByRole('button', { name: 'Approve' }).click()

    // Step 4: After router.refresh() the tag should disappear from pending list.
    // Wait for the network activity to settle.
    await page.waitForLoadState('networkidle')

    // The tag should no longer appear in the pending list (it was approved).
    await expect(page.getByText(tagSlug)).toHaveCount(0, { timeout: 10_000 })

    // Step 5: Visit /tag/<slug> — it should now render as an approved tag (200).
    const tagPageRes = await page.goto(`/tag/${tagSlug}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(tagPageRes?.status(), `expected /tag/${tagSlug} to be 200 after approval`).toBe(200)

    // The tag page h1 should contain the tag name.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`#${tagSlug}`)
  })
})
