/**
 * Phase 5 post-read page — E2E tests
 *
 * Auth strategy: same E2E shim as publish.spec.ts / editor.spec.ts.
 *   - header `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`.
 *   - env `E2E_TEST_AUTH_USER_ID` sets the user ID the bypass returns.
 *
 * DB dependency: scenarios 2–5 hit the database (Supabase service role key
 * required). They are skipped when `E2E_TEST_AUTH_USER_ID` is not set in the
 * process env (same guard used in publish.spec.ts). Scenario 1 (unknown slug
 * → 404) requires no DB because the page fast-returns `notFound()` from
 * `getCachedPost` before any meaningful DB read; but note: Supabase admin
 * client still initialises — so we use the same DB-available guard as the
 * others to stay consistent with the real CI gate.
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
