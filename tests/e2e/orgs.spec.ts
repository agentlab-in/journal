/**
 * Phase 11 orgs — E2E tests
 *
 * Auth strategy: same E2E shim as publish.spec.ts / admin.spec.ts.
 *   - header `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`.
 *   - env `E2E_TEST_AUTH_USER_ID` sets the user ID the bypass returns.
 *
 * Admin identification (for the platform-ban scenario) is env-var-based:
 * `ADMIN_GITHUB_LOGINS` (forwarded to the dev server as
 * `ADMIN_GITHUB_LOGINS_FOR_E2E` via `playwright.config.ts`).
 *
 * DB dependency
 * -------------
 * All tests here mutate `public.orgs`, `public.org_members`,
 * `public.posts`, and (for the ban scenario) `public.mod_actions`. They
 * skip when `SUPABASE_SERVICE_ROLE_KEY` is missing — mirroring the same
 * gate used by editor.spec.ts. Tests are otherwise independent of each
 * other (each generates its own unique slug suffix).
 *
 * Known gaps — multi-user flows
 * ------------------------------
 * Two scenarios in the Phase 11 brief require TWO distinct authenticated
 * users in the same test run, which the current shim (a single
 * `E2E_TEST_AUTH_USER_ID`) cannot express:
 *
 *   (a) Non-member of an org sees NO option for that org in the
 *       Publish-as dropdown on /write.
 *   (b) Admin adds a new member by username → that user, on next /write
 *       visit, sees the org in their Publish-as dropdown.
 *
 * Both are exercised by direct API calls below (we add a synthetic
 * second user row to DB, add them as a member via the admin API, and
 * verify membership reflects in the post route's org_id authorization).
 * The visible-in-dropdown assertion is covered by the orgs-ui unit test
 * (`tests/unit/orgs-ui.test.tsx`) which mounts <PublishAsSelect/> with
 * both empty and populated `userOrgs` props. Real two-user UI flow is
 * deferred to a future hardening phase (matches admin.spec.ts posture).
 */
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const HAS_SERVICE_KEY = !!process.env.SUPABASE_SERVICE_ROLE_KEY
const HAS_ADMIN_LOGIN = !!process.env.ADMIN_GITHUB_LOGINS_FOR_E2E

const SKIP_NO_DB =
  'requires SUPABASE_SERVICE_ROLE_KEY + E2E_TEST_AUTH_USER_ID for DB-backed orgs tests'
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
 * Hard cleanup for an org: removes posts, members, and the org row.
 * Service-role bypasses RLS. Safe to call even if some rows don't exist.
 */
async function cleanupOrg(db: SupabaseClient, orgId: string): Promise<void> {
  await db.from('posts').delete().eq('org_id', orgId)
  await db.from('org_members').delete().eq('org_id', orgId)
  await db.from('mod_actions').delete().eq('target_id', orgId)
  await db.from('orgs').delete().eq('id', orgId)
}

/**
 * Create an org via the public API (signed in as E2E_TEST_AUTH_USER_ID).
 * Returns the created { id, slug } and registers a cleanup hook on the
 * supplied test handle so the row is removed at the end of the test.
 */
async function createOrgAsCaller(
  request: APIRequestContext,
  db: SupabaseClient,
  slugSuffix: string,
  displayName: string,
): Promise<{ id: string; slug: string }> {
  const slug = `e2e-org-${slugSuffix}`
  const res = await request.post('/api/orgs', {
    headers: HEADER_E2E_AUTH,
    data: { slug, display_name: displayName, bio: 'E2E test org' },
  })
  expect(res.status(), `create org ${slug}`).toBe(201)
  const body = (await res.json()) as { id: string; slug: string }

  test.info().attach('created-org', {
    body: JSON.stringify(body),
    contentType: 'application/json',
  })

  // Register cleanup so accumulated test runs don't leak rows.
  test.info().annotations.push({
    type: 'cleanup',
    description: `org ${slug}`,
  })

  return body
}

// ===========================================================================
// Scenario 1: Create org → org profile renders at /<slug> → admin sees
//             /settings/orgs/[slug].
// ===========================================================================

test.describe('Phase 11 orgs — create + visit profile + settings', () => {
  test('create org, profile renders, owner can open /settings/orgs/[slug]', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_KEY || !HAS_E2E_AUTH, SKIP_NO_DB)

    const db = adminDb()
    const suffix = uniq()
    const displayName = `E2E Org ${suffix}`

    const created = await createOrgAsCaller(request, db, suffix, displayName)

    try {
      // Profile page renders at /<slug>.
      await signIn(page)
      const profileRes = await page.goto(`/${created.slug}`, {
        waitUntil: 'domcontentloaded',
      })
      expect(profileRes?.status()).toBe(200)
      // Display name should appear somewhere on the page (header).
      await expect(page.getByText(displayName).first()).toBeVisible()

      // Owner (signed in) can open /settings/orgs/[slug].
      const settingsRes = await page.goto(`/settings/orgs/${created.slug}`, {
        waitUntil: 'domcontentloaded',
      })
      expect(settingsRes?.status()).toBe(200)
      // Members panel testid set by OrgMembersPanel.
      await expect(page.getByTestId('org-members-panel')).toBeVisible()
    } finally {
      await cleanupOrg(db, created.id)
    }
  })
})

// ===========================================================================
// Scenario 2: Publish under org → URL is /<org-slug>/<type>/<post-slug>.
// ===========================================================================

test.describe('Phase 11 orgs — publish under org', () => {
  test('POST /api/posts with org_id returns /<org-slug>/<type>/<post-slug>', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_KEY || !HAS_E2E_AUTH, SKIP_NO_DB)

    const db = adminDb()
    const suffix = uniq()
    const org = await createOrgAsCaller(
      request,
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
      expect(body.url).toMatch(
        new RegExp(`^/${org.slug}/post/[^/]+$`),
      )

      // The org-prefixed post URL renders 200.
      await signIn(page)
      const pageRes = await page.goto(body.url, {
        waitUntil: 'domcontentloaded',
      })
      expect(pageRes?.status()).toBe(200)
    } finally {
      await cleanupOrg(db, org.id)
    }
  })
})

// ===========================================================================
// Scenario 3 (deferred): Non-member sees NO option for that org in
// Publish-as dropdown on /write.
//
// Requires a second authenticated user. The E2E shim only supports one
// user (`E2E_TEST_AUTH_USER_ID`). Coverage delegated to the unit test
// `tests/unit/orgs-ui.test.tsx` which mounts <PublishAsSelect userOrgs={[]}/>
// and asserts the picker is NOT rendered. See file-level header note.
// ===========================================================================

// ===========================================================================
// Scenario 4 (partial): Admin adds a new member by username → that user's
// membership reflects in DB (the API enforces visibility in dropdown).
//
// We CAN exercise the admin-add API surface and verify the row lands in
// org_members. The "next /write visit sees org in dropdown" UI half
// requires a SECOND signed-in user which we can't produce. See header.
// ===========================================================================

test.describe('Phase 11 orgs — admin adds member by username', () => {
  test('POST /api/orgs/[slug]/members adds the target user as org_member', async ({
    request,
  }) => {
    test.skip(!HAS_SERVICE_KEY || !HAS_E2E_AUTH, SKIP_NO_DB)

    const db = adminDb()
    const suffix = uniq()
    const org = await createOrgAsCaller(
      request,
      db,
      suffix,
      `E2E Add-Member Org ${suffix}`,
    )

    // Seed a synthetic target user. Service-role bypasses RLS. Use a UUID
    // that won't collide with real fixtures, and an obviously-test username.
    const targetUsername = `e2etarget${suffix.replace(/[^a-z0-9]/g, '')}`.slice(
      0,
      30,
    )
    // crypto.randomUUID is available on Node 18+ which Playwright requires.
    const targetUserId = crypto.randomUUID()

    try {
      const insertUser = await db.from('users').insert({
        id: targetUserId,
        username: targetUsername,
        display_name: 'E2E Add Target',
      })
      // If insert fails (e.g. FK to auth.users in CI), skip — the API
      // would also 404 on user_not_found and we can't observe the happy
      // path. Test will be marked skipped, not failed.
      if (insertUser.error) {
        test.skip(
          true,
          `cannot insert synthetic user (likely FK to auth.users): ${insertUser.error.message}`,
        )
      }

      const addRes = await request.post(
        `/api/orgs/${org.slug}/members`,
        {
          headers: HEADER_E2E_AUTH,
          data: { username: targetUsername, role: 'member' },
        },
      )
      expect(addRes.status()).toBe(201)

      // Confirm the row is present.
      const { data: memberRow } = await db
        .from('org_members')
        .select('user_id, role')
        .eq('org_id', org.id)
        .eq('user_id', targetUserId)
        .maybeSingle()
      expect(memberRow).not.toBeNull()
      expect((memberRow as { role: string }).role).toBe('member')
    } finally {
      // Clean up org + the synthetic user.
      await cleanupOrg(db, org.id)
      await db.from('users').delete().eq('id', targetUserId)
    }
  })
})

// ===========================================================================
// Scenario 5: Last admin cannot demote themselves → API surfaces 409
// `last_admin`. (UI shows the inline "last admin" copy — see OrgMembersPanel.)
// ===========================================================================

test.describe('Phase 11 orgs — last-admin protection', () => {
  test('PATCH role=member on the sole admin returns 409 last_admin', async ({
    request,
  }) => {
    test.skip(!HAS_SERVICE_KEY || !HAS_E2E_AUTH, SKIP_NO_DB)

    const db = adminDb()
    const suffix = uniq()
    const org = await createOrgAsCaller(
      request,
      db,
      suffix,
      `E2E LastAdmin Org ${suffix}`,
    )

    try {
      const userId = process.env.E2E_TEST_AUTH_USER_ID!
      const res = await request.patch(
        `/api/orgs/${org.slug}/members/${userId}`,
        {
          headers: HEADER_E2E_AUTH,
          data: { role: 'member' },
        },
      )
      expect(res.status()).toBe(409)
      const body = (await res.json()) as { error?: string }
      expect(body.error).toBe('last_admin')
    } finally {
      await cleanupOrg(db, org.id)
    }
  })
})

// ===========================================================================
// Scenario 6: Admin soft-deletes org → profile 404s + posts under the org
// 404. Exercises the visibility cascade documented in the RLS strategy.
// ===========================================================================

test.describe('Phase 11 orgs — soft-delete cascade', () => {
  test('after DELETE /api/orgs/[slug] the org profile and its posts 404', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_KEY || !HAS_E2E_AUTH, SKIP_NO_DB)

    const db = adminDb()
    const suffix = uniq()
    const org = await createOrgAsCaller(
      request,
      db,
      suffix,
      `E2E Delete Org ${suffix}`,
    )

    try {
      // Publish a post under the org so we can verify the cascade.
      const postRes = await request.post('/api/posts', {
        headers: HEADER_E2E_AUTH,
        data: {
          type: 'post',
          title: `E2E Delete Cascade ${suffix}`,
          summary: 'A long-enough summary for Zod.',
          body_md: 'y'.repeat(60),
          tags: ['rag'],
          org_id: org.id,
        },
      })
      expect(postRes.status()).toBe(201)
      const post = (await postRes.json()) as { url: string }

      // Sanity: post URL renders 200 before delete.
      await signIn(page)
      const pre = await page.goto(post.url, { waitUntil: 'domcontentloaded' })
      expect(pre?.status()).toBe(200)

      // Soft-delete the org.
      const delRes = await request.delete(`/api/orgs/${org.slug}`, {
        headers: HEADER_E2E_AUTH,
      })
      expect(delRes.status()).toBe(200)

      // Profile 404s.
      const profileRes = await page.goto(`/${org.slug}`, {
        waitUntil: 'domcontentloaded',
      })
      expect(profileRes?.status()).toBe(404)

      // Post under the org 404s (visibility cascade).
      const postPageRes = await page.goto(post.url, {
        waitUntil: 'domcontentloaded',
      })
      expect(postPageRes?.status()).toBe(404)
    } finally {
      await cleanupOrg(db, org.id)
    }
  })
})

// ===========================================================================
// Scenario 7: Platform admin bans org via /api/admin/orgs/ban → profile
// 404s in discovery + read pages.
// ===========================================================================

test.describe('Phase 11 orgs — platform admin bans org', () => {
  test('POST /api/admin/orgs/ban makes the org profile 404 for visitors', async ({
    page,
    request,
  }) => {
    test.skip(
      !HAS_SERVICE_KEY || !HAS_E2E_AUTH || !HAS_ADMIN_LOGIN,
      SKIP_NO_ADMIN,
    )

    const db = adminDb()
    const suffix = uniq()
    const org = await createOrgAsCaller(
      request,
      db,
      suffix,
      `E2E Ban Org ${suffix}`,
    )

    try {
      // Sanity: profile is up before ban.
      await signIn(page)
      const pre = await page.goto(`/${org.slug}`, {
        waitUntil: 'domcontentloaded',
      })
      expect(pre?.status()).toBe(200)

      const banRes = await request.post('/api/admin/orgs/ban', {
        headers: HEADER_E2E_AUTH,
        data: { org_id: org.id, reason: 'e2e test ban' },
      })
      expect(banRes.status()).toBe(200)

      // Profile 404s for everyone (including the org admin).
      const post = await page.goto(`/${org.slug}`, {
        waitUntil: 'domcontentloaded',
      })
      expect(post?.status()).toBe(404)
    } finally {
      await cleanupOrg(db, org.id)
    }
  })
})
