/**
 * Phase 5 post-read page — E2E tests
 *
 * Auth strategy: same E2E shim as publish.spec.ts / editor.spec.ts.
 *   - header `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`.
 *   - env `E2E_TEST_AUTH_USER_ID` sets the user ID the bypass returns.
 *
 * DB dependency: ALL scenarios require Supabase because the page route's
 * `getCachedPost` constructs the admin client even for the 404 path. In CI
 * (no Supabase env), `createAdminSupabaseClient()` throws and the page 500s
 * instead of rendering Next.js's not-found page. We gate every test on
 * `E2E_TEST_AUTH_USER_ID` (same guard used in publish.spec.ts) so the suite
 * runs locally with a real backend and cleanly skips in CI.
 *
 * Navigation calls use `waitUntil: 'domcontentloaded'` to tolerate the
 * ViewBeacon's fire-and-forget fetch that can keep the page "loading".
 */
import { test, expect, type Page } from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const SKIP_REASON = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A minimal valid POST /api/posts body for a plain 'post' type.
 * `suffix` should be a unique string (e.g. `String(Date.now())`) so that
 * the derived slug never collides with existing posts.
 */
function validPostBody(suffix: string) {
  return {
    type: 'post',
    title: `E2E Post Page ${suffix}`,
    summary: 'A sufficiently long summary that passes validation.',
    body_md: 'x'.repeat(60),
    tags: ['rag'],
  }
}

/**
 * Like `validPostBody`, but embeds a wikilink in the body so that a
 * `post_references` row is created pointing at the post whose title is
 * `targetTitle`.
 */
function validPostBodyWithBacklink(suffix: string, targetTitle: string) {
  const body = `[[${targetTitle}]] ` + 'y'.repeat(50)
  return {
    type: 'post',
    title: `E2E Backlink Source ${suffix}`,
    summary: 'A sufficiently long summary that passes validation.',
    body_md: body,
    tags: ['rag'],
  }
}

/** Make `page` send the E2E auth shim header on every request. */
async function signIn(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Phase 5 post-read page', () => {
  // -------------------------------------------------------------------------
  // 1. Anonymous GET /unknown/post/unknown-slug → 404 page renders
  // -------------------------------------------------------------------------
  test('anonymous GET to unknown slug returns 404 and renders not-found content', async ({
    page,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const response = await page.goto('/unknown-user-abc/post/unknown-slug-xyz', {
      waitUntil: 'domcontentloaded',
    })

    // Next.js renders the not-found page with a 404 status
    expect(response?.status()).toBe(404)

    // The project's not-found.tsx contains "page not found" (lowercase)
    await expect(page.getByText(/page not found/i)).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 2. Authed user creates a post → visit URL → renders title + body
  // -------------------------------------------------------------------------
  test('created post URL renders the post title and body', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const postBody = validPostBody(suffix)

    // Create the post via the API
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: postBody,
    })
    expect(createRes.status()).toBe(201)

    const { url } = (await createRes.json()) as { url: string }
    expect(typeof url).toBe('string')
    expect(url).toMatch(/^\/[^/]+\/post\/[^/]+$/)

    // Anonymous browser visit (no auth header) — the page is public
    const pageRes = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(pageRes?.status()).toBe(200)

    // Title renders in the h1
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(postBody.title)

    // Body text is present somewhere on the page (rendered from body_md)
    await expect(page.locator('body')).toContainText('x'.repeat(20))
  })

  // -------------------------------------------------------------------------
  // 3. Author sees Edit + Delete; anonymous visitor does not
  // -------------------------------------------------------------------------
  test('author sees Edit and Delete; anonymous visitor does not', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())

    // Create the post
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: validPostBody(suffix),
    })
    expect(createRes.status()).toBe(201)
    const { url } = (await createRes.json()) as { url: string }

    // --- Anonymous visit: no author controls ---
    const anonPageRes = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(anonPageRes?.status()).toBe(200)

    await expect(page.getByRole('link', { name: 'Edit' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete' })).not.toBeVisible()

    // --- Authed visit as the stub user (who is the author) ---
    await signIn(page)
    const authedPageRes = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(authedPageRes?.status()).toBe(200)

    await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 4. Delete flow: confirm → DELETE → redirect home → original URL is 404
  // -------------------------------------------------------------------------
  test('delete flow redirects to / and makes the post URL 404', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())

    // Create the post
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: validPostBody(suffix),
    })
    expect(createRes.status()).toBe(201)
    const { url } = (await createRes.json()) as { url: string }

    // Browse to the post as the author
    await signIn(page)
    await page.goto(url, { waitUntil: 'domcontentloaded' })

    // Accept the confirm dialog that appears when Delete is clicked
    page.once('dialog', (dialog) => dialog.accept())

    // Click Delete
    await page.getByRole('button', { name: 'Delete' }).click()

    // Wait for AuthorActions to redirect via window.location.assign('/')
    await page.waitForURL('/', { timeout: 10_000 })
    expect(new URL(page.url()).pathname).toBe('/')

    // Now re-visit the original URL anonymously — the post is soft-deleted
    const revisitRes = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(revisitRes?.status()).toBe(404)
  })

  // -------------------------------------------------------------------------
  // 5. "Referenced by" appears when another post wikilinks this one
  // -------------------------------------------------------------------------
  test('"Referenced by" section appears for a post that is wikilinked by another', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())

    // Post A — the target post that will be referenced
    const postATitle = `Referenced Post One ${suffix}`
    const createARes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: {
        type: 'post',
        title: postATitle,
        summary: 'A sufficiently long summary that passes validation.',
        body_md: 'z'.repeat(60),
        tags: ['rag'],
      },
    })
    expect(createARes.status()).toBe(201)
    const { url: urlA } = (await createARes.json()) as { url: string }

    // Post B — embeds a wikilink pointing at post A
    const createBRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: validPostBodyWithBacklink(suffix, postATitle),
    })
    expect(createBRes.status()).toBe(201)
    const { url: urlB } = (await createBRes.json()) as { url: string }

    // Visit post A's public page
    const pageARes = await page.goto(urlA, { waitUntil: 'domcontentloaded' })
    expect(pageARes?.status()).toBe(200)

    // "Referenced by" heading should be visible
    await expect(
      page.getByRole('heading', { name: /referenced by/i }),
    ).toBeVisible({ timeout: 10_000 })

    // A link to post B's URL should appear in the backlinks section
    const backlinkLocator = page.locator('.backlinks').getByRole('link')
    await expect(backlinkLocator).toHaveAttribute('href', urlB)
  })
})

// ---------------------------------------------------------------------------
// Issue #70 — home discovery rails on the read page
//
// The read page now renders inside the same HomeShell three-column shell
// used by `/`: LeftNav on the left (nav-only), the consolidated discovery
// RightSidebar on the right, article in the center. The body keeps its narrow
// prose cap; only the surrounding shell widens.
// ---------------------------------------------------------------------------

test.describe('issue #70 — discovery rails on the read page', () => {
  /** Create a post via the API and return its public URL. */
  async function seedPost(
    request: import('@playwright/test').APIRequestContext,
  ): Promise<string> {
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: validPostBody(String(Date.now())),
    })
    expect(createRes.status()).toBe(201)
    const { url } = (await createRes.json()) as { url: string }
    return url
  }

  // -------------------------------------------------------------------------
  // 6. At xl the read page shows the same three-column shell as `/`.
  // -------------------------------------------------------------------------
  test('xl read page renders the three-column shell with left nav + right sidebar', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const url = await seedPost(request)

    // xl viewport (>=1280) so both asides are visible.
    await page.setViewportSize({ width: 1440, height: 900 })
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // The shared HomeShell grid wraps the article.
    await expect(page.locator('.home-shell')).toBeVisible()

    // Left sidebar (xl-only) carries the same section nav as on `/`.
    const left = page.locator('aside.home-shell__left')
    await expect(left).toBeVisible()
    await expect(left.locator('.left-nav__list')).toBeVisible()
    await expect(
      left.getByRole('link', { name: 'Home', exact: true }),
    ).toBeVisible()

    // Right sidebar (lg+) is present.
    await expect(page.locator('aside.home-shell__right')).toBeVisible()

    // The article still renders inside the center column.
    await expect(page.locator('article.post-page h1')).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 7. Below lg the read page collapses to a single column.
  // -------------------------------------------------------------------------
  test('<lg read page collapses to a single column (both asides hidden)', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const url = await seedPost(request)

    // Below lg (<1024) both desktop asides are hidden; LeftNav relocates to
    // the top nav (.nav-leftnav) exactly like on `/`.
    await page.setViewportSize({ width: 800, height: 900 })
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    await expect(page.locator('aside.home-shell__left')).toBeHidden()
    await expect(page.locator('aside.home-shell__right')).toBeHidden()

    // The article is the primary content at this width.
    await expect(page.locator('article.post-page')).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 8. The post body keeps its narrow prose cap inside the wider shell.
  // -------------------------------------------------------------------------
  test('post body keeps its narrow prose cap inside the wider shell', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const url = await seedPost(request)

    await page.setViewportSize({ width: 1440, height: 900 })
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // The article container stays capped at 720px even though the center
    // column is far wider — the shell provides air, not wider prose.
    const articleWidth = await page
      .locator('article.post-page')
      .evaluate((el) => el.getBoundingClientRect().width)
    expect(articleWidth).toBeLessThanOrEqual(720)

    // The rendered body keeps its 70ch line-length cap, narrower still.
    const bodyWidth = await page
      .locator('.post-body')
      .evaluate((el) => el.getBoundingClientRect().width)
    expect(bodyWidth).toBeLessThanOrEqual(720)
  })
})

// ---------------------------------------------------------------------------
// Structured sections — playbook vs deep dive disclosure shapes
//
// Playbook: the four structured sections (Environment/Target, Prerequisites,
// Core Instructions, Safety/Failure Modes) are wrapped in ONE <details> that
// defaults CLOSED. Deep dive: TL;DR + The Question stay individually
// collapsible and default-open (unchanged from PR #73).
// ---------------------------------------------------------------------------

test.describe('structured sections disclosure', () => {
  const PLAYBOOK_BODY = [
    '## Environment / Target',
    'A mac mini running the agent.',
    '',
    '## Prerequisites',
    'The gh CLI must be installed.',
    '',
    '## Core Instructions',
    'Clone the repo and run the harness.',
    '',
    '## Safety / Failure Modes',
    'Never push to main.',
  ].join('\n')

  const DIVE_BODY = [
    '## TL;DR',
    'The short answer to the question.',
    '',
    '## The Question',
    'A longer exploration of the question at hand.',
  ].join('\n')

  /** Create a playbook/dive post via the API and return its public URL. */
  async function seedStructured(
    request: import('@playwright/test').APIRequestContext,
    type: 'playbook' | 'dive',
    body_md: string,
  ): Promise<string> {
    const suffix = String(Date.now()) + Math.round(performance.now())
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: {
        type,
        title: `E2E ${type} ${suffix}`,
        summary: 'A sufficiently long summary that passes validation.',
        body_md,
        tags: ['rag'],
      },
    })
    expect(createRes.status()).toBe(201)
    const { url } = (await createRes.json()) as { url: string }
    return url
  }

  // -------------------------------------------------------------------------
  // Playbook: one wrapper <details>, default closed, opens on click.
  // -------------------------------------------------------------------------
  test('playbook wraps four sections in one disclosure that defaults closed', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const url = await seedStructured(request, 'playbook', PLAYBOOK_BODY)
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // Exactly ONE disclosure wraps the whole structured block.
    const disclosure = page.locator('details.structured-sections__disclosure')
    await expect(disclosure).toHaveCount(1)
    // ...and no per-section <details> leaked in (the walked-back design).
    await expect(page.locator('details.structured-section')).toHaveCount(0)

    // Default state is CLOSED.
    expect(await disclosure.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
      false,
    )

    // The four section headings are hidden while collapsed.
    const heading = page.getByRole('heading', { name: 'Core Instructions' })
    await expect(heading).toBeHidden()

    // Clicking the summary opens it and reveals all four <h3> headings.
    await page.getByText('Playbook details', { exact: true }).click()
    expect(await disclosure.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
      true,
    )
    for (const label of [
      'Environment / Target',
      'Prerequisites',
      'Core Instructions',
      'Safety / Failure Modes',
    ]) {
      await expect(page.getByRole('heading', { name: label })).toBeVisible()
    }

    // No persistence — a reload returns to the closed default.
    await page.reload({ waitUntil: 'domcontentloaded' })
    expect(await disclosure.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
      false,
    )
  })

  // -------------------------------------------------------------------------
  // Deep dive: two individual <details>, both default-open (PR #73 design).
  // -------------------------------------------------------------------------
  test('deep dive keeps two individual disclosures, both default open', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const url = await seedStructured(request, 'dive', DIVE_BODY)
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // Two per-section disclosures, no single-wrapper disclosure.
    const sections = page.locator('details.structured-section')
    await expect(sections).toHaveCount(2)
    await expect(
      page.locator('details.structured-sections__disclosure'),
    ).toHaveCount(0)

    // Both default open → first-time readers see the hook immediately.
    const openStates = await sections.evaluateAll((els) =>
      els.map((el) => (el as HTMLDetailsElement).open),
    )
    expect(openStates).toEqual([true, true])
  })
})
