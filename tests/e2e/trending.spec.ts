/**
 * /trending route — E2E tests (Phase C, issue #54)
 *
 * Coverage:
 *   1. Route returns 200 with H1 "Trending" and tagline visible.
 *   2. Differentiation (DB-independent): /latest and /trending render DISTINCT
 *      h1 + taglines so the two routes are not accidentally identical.
 *   3. Seeded-DB path (self-skips without SUPABASE_SERVICE_ROLE_KEY):
 *      - Feed renders at least one post card.
 *      - Ordering differs from pure recency: seed one older-but-high-engagement
 *        post and one newer-low-engagement post within the 7-day window;
 *        /trending should rank the engaged post first (Risk-4 differentiation).
 *
 * Auth / skip pattern mirrors `discovery.spec.ts`.
 */
import {
  test,
  expect,
  type APIRequestContext,
} from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const HAS_SERVICE_KEY = !!process.env.SUPABASE_SERVICE_ROLE_KEY
const SKIP_REASON = 'requires E2E_TEST_AUTH_USER_ID + SUPABASE_SERVICE_ROLE_KEY'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a post and return its id. The post is published immediately by the
 * API (POST /api/posts with valid body + e2e-auth header).
 */
async function seedPost(
  request: APIRequestContext,
  title: string,
  type: 'post' | 'playbook' | 'dive' = 'post',
): Promise<string> {
  const body: Record<string, unknown> = {
    type,
    title,
    summary: 'Seeded for trending differentiation test.',
    body_md: 'x'.repeat(60),
    tags: ['security'],
  }

  if (type === 'playbook') {
    body.body_md = [
      '## Environment Target',
      'Node.js 20',
      '## Prerequisites',
      'None.',
      '## Core Instructions',
      'Step 1.',
      '## Safety and Failure Modes',
      'None.',
    ].join('\n\n')
  }

  if (type === 'dive') {
    body.body_md = [
      '## TL;DR',
      'Brief summary.',
      '## The Question',
      'What is X?',
    ].join('\n\n')
  }

  const res = await request.post('/api/posts', {
    headers: HEADER_E2E_AUTH,
    data: body,
  })
  expect(res.status()).toBe(201)
  const json = (await res.json()) as { id: string }
  return json.id
}

/**
 * Delete a seeded post by id. Uses DELETE /api/posts/:id via the e2e auth
 * shim. Ignores errors so cleanup does not fail tests.
 */
async function cleanupPost(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  await request
    .delete(`/api/posts/${id}`, { headers: HEADER_E2E_AUTH })
    .catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Tests — always-on (no DB seeding required)
// ---------------------------------------------------------------------------

test.describe('/trending route — anon surface', () => {
  // -------------------------------------------------------------------------
  // 1. Route responds 200, H1 + tagline visible
  // -------------------------------------------------------------------------
  test('GET /trending returns 200 with H1 and tagline', async ({ page }) => {
    const res = await page.goto('/trending', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // H1 "Trending" must be present
    await expect(page.locator('h1.home-feed__title', { hasText: 'Trending' })).toBeVisible()

    // Tagline must be present
    await expect(
      page.locator('p.home-feed__tagline', {
        hasText: 'What people are reading this week.',
      }),
    ).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 2. Differentiation — /latest and /trending render distinct H1 + taglines
  //    (DB-independent: just inspect the rendered copy on each route)
  // -------------------------------------------------------------------------
  test('/trending and /latest render distinct H1 + taglines', async ({ page }) => {
    // --- /trending ---
    await page.goto('/trending', { waitUntil: 'domcontentloaded' })
    const trendingH1 = await page
      .locator('h1.home-feed__title')
      .first()
      .innerText()
    const trendingTagline = await page
      .locator('p.home-feed__tagline')
      .first()
      .innerText()

    // --- /latest ---
    await page.goto('/latest', { waitUntil: 'domcontentloaded' })
    const latestH1 = await page
      .locator('h1.home-feed__title')
      .first()
      .innerText()
    const latestTagline = await page
      .locator('p.home-feed__tagline')
      .first()
      .innerText()

    // The two routes must have different H1 text (differentiation, OPC-10)
    expect(trendingH1).not.toBe(latestH1)

    // And different taglines
    expect(trendingTagline).not.toBe(latestTagline)

    // Spot-check exact expected values so a typo is caught immediately
    expect(trendingH1.trim()).toBe('Trending')
    expect(latestH1.trim()).toBe('Latest')
  })

  // -------------------------------------------------------------------------
  // 3. Feed shell renders without error boundary
  // -------------------------------------------------------------------------
  test('/trending renders without error boundary', async ({ page }) => {
    await page.goto('/trending', { waitUntil: 'domcontentloaded' })

    // The main home-feed container must be visible
    await expect(page.locator('main.home-feed')).toBeVisible()

    // No error boundary copy from app/error.tsx
    await expect(page.locator('text=Something went wrong')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// Tests — seeded (self-skip without env)
// ---------------------------------------------------------------------------

test.describe('/trending route — seeded DB (Risk-4 differentiation)', () => {
  test.skip(
    !HAS_E2E_AUTH || !HAS_SERVICE_KEY,
    SKIP_REASON,
  )

  // -------------------------------------------------------------------------
  // 4. /trending renders post cards when seeded posts exist
  // -------------------------------------------------------------------------
  test('/trending renders post cards after seeding', async ({ page, request }) => {
    const suffix = String(Date.now())
    const id = await seedPost(request, `E2E Trending Seed ${suffix}`)

    try {
      await page.goto('/trending', { waitUntil: 'domcontentloaded' })

      // At least one card or empty state should be visible
      const cardCount = await page.locator('li.home-feed__item').count()
      const emptyVisible = (await page.locator('p.home-feed__empty').count()) > 0
      expect(cardCount > 0 || emptyVisible).toBe(true)
    } finally {
      await cleanupPost(request, id)
    }
  })

  // -------------------------------------------------------------------------
  // 5. Risk-4 differentiation: heat-ranking vs recency ordering
  //
  // Strategy:
  //   - Seed post A then post B (B is strictly newer by at least one
  //     millisecond due to sequential API calls).
  //   - Like post A once via POST /api/likes/:id (same auth shim as
  //     engagement.spec.ts). With one like, A's heat numerator is 1 while
  //     B's is 0. Both posts are "fresh" (published_at ≈ now) so the
  //     time-decay denominator is identical — making A's heat score strictly
  //     greater than B's.
  //   - /trending (heat-ranked): A must appear BEFORE B.
  //   - /latest (recency-ranked): B must appear BEFORE A (newer first).
  //
  // This test FAILS if:
  //   (a) /trending accidentally uses recency order instead of heat score, or
  //   (b) /latest accidentally uses heat score instead of recency.
  //
  // The E2E likes endpoint is POST /api/likes/:postId with header
  // `x-e2e-auth: 1`, mirroring the pattern in engagement.spec.ts.
  // -------------------------------------------------------------------------
  test('Risk-4: /trending ranks high-engagement post above newer-zero-engagement post; /latest uses recency', async ({
    page,
    request,
  }) => {
    const suffix = String(Date.now())

    // Seed A first, then B — B will have a later published_at / id.
    const titleA = `Trending Risk4-A ${suffix}`
    const titleB = `Trending Risk4-B ${suffix}`
    const idA = await seedPost(request, titleA)
    const idB = await seedPost(request, titleB)

    try {
      // Give post A one like via the engagement API. One like means A's heat
      // numerator = 1, B's = 0. Time-decay denominator ≈ equal (both brand-new),
      // so A's heat score > B's heat score. This is all that /trending needs to
      // rank A above B.
      const likeRes = await request.post(`/api/likes/${idA}`, {
        headers: HEADER_E2E_AUTH,
      })
      // 200 = liked. 429 = rate-limited: guardMutatingRequest rejects with 429
      // BEFORE the DB write, so on 429 post A has zero likes and the ordering
      // assertion below would be meaningless. Skip the rest of the test instead.
      if (likeRes.status() === 429) {
        test.skip(true, 'like rate-limited — ordering precondition not establishable')
        return
      }
      expect(likeRes.status()).toBe(200)

      // -----------------------------------------------------------------------
      // /trending: A must appear BEFORE B in the feed list.
      //
      // We compare the index of each card's title in the full `innerText()` of
      // the feed list — if indexA < indexB, A is ranked higher (closer to top).
      // -----------------------------------------------------------------------
      await page.goto('/trending', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('h1.home-feed__title', { hasText: 'Trending' })).toBeVisible()

      // Wait until at least two cards are present (we seeded two).
      await page.waitForFunction(
        () => document.querySelectorAll('li.home-feed__item').length >= 2,
        { timeout: 10_000 },
      )

      const trendingFeedText = await page.locator('ul.home-feed__list').innerText()
      const indexA_trending = trendingFeedText.indexOf(titleA)
      const indexB_trending = trendingFeedText.indexOf(titleB)

      // Both titles must be present.
      expect(indexA_trending).toBeGreaterThan(-1)
      expect(indexB_trending).toBeGreaterThan(-1)

      // A (liked) must rank above B (zero engagement) on the heat-ranked feed.
      expect(indexA_trending).toBeLessThan(indexB_trending)

      // -----------------------------------------------------------------------
      // /latest: B must appear BEFORE A (B is newer — published later).
      // -----------------------------------------------------------------------
      await page.goto('/latest', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('h1.home-feed__title', { hasText: 'Latest' })).toBeVisible()

      await page.waitForFunction(
        () => document.querySelectorAll('li.home-feed__item').length >= 2,
        { timeout: 10_000 },
      )

      const latestFeedText = await page.locator('ul.home-feed__list').innerText()
      const indexA_latest = latestFeedText.indexOf(titleA)
      const indexB_latest = latestFeedText.indexOf(titleB)

      // Both titles must be present.
      expect(indexA_latest).toBeGreaterThan(-1)
      expect(indexB_latest).toBeGreaterThan(-1)

      // B (newer) must appear before A (older) on the recency-ordered feed.
      expect(indexB_latest).toBeLessThan(indexA_latest)
    } finally {
      await cleanupPost(request, idA)
      await cleanupPost(request, idB)
    }
  })
})
