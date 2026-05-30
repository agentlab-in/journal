/**
 * Phase 9 discovery surface — E2E tests
 *
 * Covers the anon-visible discovery routes (home feed, /latest, /search,
 * /tags, /tag/[slug], and the nav search affordance) plus a few authed
 * scenarios that need DB-seeded data.
 *
 * Auth strategy mirrors engagement.spec.ts:
 *   - header `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`.
 *   - env `E2E_TEST_AUTH_USER_ID` sets the user ID the bypass returns
 *     (defaulted to the canonical UUID in `playwright.config.ts`).
 *   - HAS_E2E_AUTH gates DB-dependent scenarios so the suite cleanly
 *     skips in environments without a wired-up Supabase service role.
 *
 * Navigations use `waitUntil: 'domcontentloaded'` so we don't trip on
 * background fetches the route may fire after first paint.
 */
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const SKIP_REASON = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make `page` send the E2E auth shim header on every request. */
async function signIn(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
}

/**
 * Seed a fresh post with the given tag via POST /api/posts as the E2E
 * user. Returns id / url / title so tests can chase the seeded row.
 */
async function createPostWithTag(
  request: APIRequestContext,
  suffix: string,
  tag: string,
): Promise<{ id: string; url: string; title: string }> {
  const title = `E2E Discovery Post ${suffix}`
  const res = await request.post('/api/posts', {
    headers: HEADER_E2E_AUTH,
    data: {
      type: 'post',
      title,
      summary: 'A sufficiently long summary that passes validation.',
      body_md: 'x'.repeat(60),
      tags: [tag],
    },
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { id: string; url: string }
  return { id: body.id, url: body.url, title }
}

// ---------------------------------------------------------------------------
// Tests — always-on (no DB seeding required)
// ---------------------------------------------------------------------------

test.describe('Phase 9 discovery — anon surface', () => {
  // -------------------------------------------------------------------------
  // 1. Anon `/` returns 200 and renders the feed shell.
  // -------------------------------------------------------------------------
  test('anon GET / renders the feed shell with 200', async ({ page }) => {
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // <main class="home-feed"> is the page shell — present even when the
    // feed is empty.
    await expect(page.locator('main.home-feed')).toBeVisible()

    // Either the "Latest" header is present OR there's a populated list of
    // post cards. We don't require both because a fresh DB may have no
    // posts to render, but the heading is always rendered.
    const latestHeader = page.locator('h1.home-feed__title', { hasText: 'Latest' })
    const cardList = page.locator('ul.home-feed__list')
    const hasHeader = (await latestHeader.count()) > 0
    const hasCards = (await cardList.count()) > 0
    expect(hasHeader || hasCards).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 2. Unknown tag slug returns 404.
  // -------------------------------------------------------------------------
  test('GET /tag/<unknown> returns 404', async ({ page }) => {
    const res = await page.goto(
      '/tag/unknown-tag-that-does-not-exist-12345',
      { waitUntil: 'domcontentloaded' },
    )
    expect(res?.status()).toBe(404)
  })

  // -------------------------------------------------------------------------
  // 3. Nav search input submits to /search?q=foo on Enter.
  // -------------------------------------------------------------------------
  test('nav search input submits to /search?q=foo', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const navInput = page.getByLabel('Search posts', { exact: true })
    await expect(navInput).toBeVisible()
    await navInput.fill('foo')
    await navInput.press('Enter')

    await page.waitForURL(/\/search\?q=foo$/, { timeout: 10_000 })

    const finalUrl = new URL(page.url())
    expect(finalUrl.pathname).toBe('/search')
    expect(finalUrl.searchParams.get('q')).toBe('foo')
  })

  // -------------------------------------------------------------------------
  // 4. '/' keyboard shortcut focuses the nav search input.
  // -------------------------------------------------------------------------
  test("'/' shortcut focuses the nav search input", async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // Make sure focus isn't already on an input — body is the safe default.
    await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      if (active && active.tagName !== 'BODY') active.blur()
    })

    await page.keyboard.press('/')

    // The shim listens on the window keydown event; assert the input is
    // the new document.activeElement.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? null), {
        timeout: 5_000,
      })
      .toBe('nav-search-input')
  })

  // -------------------------------------------------------------------------
  // 5. /search with empty q renders the form + featured tag chips.
  // -------------------------------------------------------------------------
  test('GET /search with no query renders form + featured chips', async ({
    page,
  }) => {
    const res = await page.goto('/search', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // The search form itself.
    await expect(page.locator('form.search-page__form')).toBeVisible()

    // At least one featured tag chip should appear in the empty-state
    // suggestions list — #security is the first slug in FEATURED_TAG_SLUGS.
    await expect(
      page.locator('ul.search-page__suggestions a.tag-chip', {
        hasText: '#security',
      }),
    ).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 6. /search?q=<nonsense> renders the "No posts match." empty state.
  // -------------------------------------------------------------------------
  test('GET /search with no-match query renders empty state', async ({
    page,
  }) => {
    const nonsense = 'somenonsensequery_xyz789_no_match'
    const res = await page.goto(`/search?q=${encodeURIComponent(nonsense)}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(res?.status()).toBe(200)

    await expect(
      page.locator('p.search-page__empty', {
        hasText: 'No posts match.',
      }),
    ).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 7. /tags renders the All approved tags page.
  // -------------------------------------------------------------------------
  test('GET /tags renders the directory', async ({ page }) => {
    const res = await page.goto('/tags', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // The h1 "All tags" must always render. The "Featured" h2 only shows
    // when at least one featured slug resolves to an approved tag — which
    // requires a wired-up Supabase. Skip the h2 assertion here so the
    // test works against the placeholder env CI runs with; the seeded
    // /tag/security test below exercises the real DB path.
    await expect(
      page.getByRole('heading', { name: 'All tags', level: 1 }),
    ).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Tests — seeded (gated on HAS_E2E_AUTH)
// ---------------------------------------------------------------------------

test.describe('Phase 9 discovery — authed + seeded', () => {
  // -------------------------------------------------------------------------
  // 8. Authed `/` renders For You without erroring.
  //
  // Heat-ranking + caching means the freshly seeded post may not surface
  // in the top N; we don't assert against the specific seeded post — only
  // that the page renders with 200 and at least one card is visible.
  // -------------------------------------------------------------------------
  test('authed GET / renders For You without crashing', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    await createPostWithTag(request, `foryou-${suffix}`, 'security')

    await signIn(page)
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // Either "For you" or "Latest" header — the For You path falls back to
    // Latest if `getForYouFeed` throws, and we treat both as a non-crash.
    await expect(page.locator('h1.home-feed__title')).toBeVisible()

    // The error boundary copy from app/error.tsx must NOT be visible. We
    // don't depend on the exact text — assert no <h2> reading "Something
    // went wrong" (the Next.js default surfaced by error.tsx).
    await expect(page.locator('text=Something went wrong')).toHaveCount(0)

    // At least one post card OR the empty-state copy — depending on
    // whether the shared dev DB has any seeded posts. The seeded post
    // above guarantees at least one visible card unless the For You path
    // filters it out, in which case the fallback Latest path should still
    // surface it.
    const cardCount = await page.locator('li.home-feed__item').count()
    const emptyVisible =
      (await page.locator('p.home-feed__empty').count()) > 0
    expect(cardCount > 0 || emptyVisible).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 9. /latest?after=<cursor> paginates without dupes.
  //
  // Seeding 32 posts is expensive, so we take the lighter path described in
  // the task spec: visit /latest, follow the "Older →" link if it's there,
  // and assert the URL gains an `?after=` cursor and there's no crash.
  // The richer "no overlap" assertion is left to a backfill follow-up.
  // -------------------------------------------------------------------------
  test('/latest "Older →" link advances with an after cursor', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    // Seed one extra post so the existing dev DB nudges over the page
    // boundary in case it's exactly at PAGE_SIZE. Cheap.
    await createPostWithTag(
      request,
      `latest-pagination-${String(Date.now())}`,
      'security',
    )

    const res = await page.goto('/latest', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    const olderLink = page.getByRole('link', { name: 'Older →' })
    const olderCount = await olderLink.count()

    if (olderCount === 0) {
      // Dev DB has ≤ PAGE_SIZE posts — pagination link not rendered.
      // Assert no crash and bail. This branch is documented as a known
      // skip; backfilling 32+ seed posts is a follow-up.
      test.info().annotations.push({
        type: 'note',
        description:
          'Skipping pagination assertion: dev DB has ≤ PAGE_SIZE posts so ' +
          '/latest does not render the "Older →" link.',
      })
      return
    }

    // Capture page-1 titles so we can sanity-check there's no overlap
    // with page 2 (best-effort — full 32-post seed would be more robust).
    const page1Titles = await page
      .locator('h3.post-card__title')
      .allInnerTexts()

    await olderLink.first().click()
    await page.waitForLoadState('domcontentloaded')

    const finalUrl = new URL(page.url())
    expect(finalUrl.pathname).toBe('/latest')
    expect(finalUrl.searchParams.get('after')).toBeTruthy()

    const page2Titles = await page
      .locator('h3.post-card__title')
      .allInnerTexts()

    // No title from page 1 should reappear on page 2 — cursor pagination
    // is exclusive of the boundary row.
    const overlap = page2Titles.filter((t) => page1Titles.includes(t))
    expect(overlap).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 10. /tag/<slug> filter chips update the URL.
  //
  // 'security' is in the featured-tag seed and is guaranteed approved, so
  // /tag/security renders deterministically.
  // -------------------------------------------------------------------------
  test('/tag/<slug> type chips update the URL', async ({ page }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const res = await page.goto('/tag/security', {
      waitUntil: 'domcontentloaded',
    })
    expect(res?.status()).toBe(200)

    // Confirm the type-filter nav is on the page before clicking.
    const typeFilters = page.locator(
      'nav.tag-page__filters[aria-label="Type filter"]',
    )
    await expect(typeFilters).toBeVisible()

    // Click "Playbooks" — should land on /tag/security?type=playbook.
    await typeFilters.getByRole('link', { name: 'Playbooks' }).click()
    await page.waitForURL(/\/tag\/security\?type=playbook$/, {
      timeout: 10_000,
    })

    const playbookUrl = new URL(page.url())
    expect(playbookUrl.pathname).toBe('/tag/security')
    expect(playbookUrl.searchParams.get('type')).toBe('playbook')

    // Click "All" — should drop the type qs back to /tag/security.
    const typeFiltersAfter = page.locator(
      'nav.tag-page__filters[aria-label="Type filter"]',
    )
    await typeFiltersAfter.getByRole('link', { name: 'All' }).click()
    await page.waitForURL(/\/tag\/security$/, { timeout: 10_000 })

    const allUrl = new URL(page.url())
    expect(allUrl.pathname).toBe('/tag/security')
    expect(allUrl.searchParams.get('type')).toBeNull()
  })
})
