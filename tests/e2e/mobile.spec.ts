/**
 * Phase 13 mobile-breakpoints sweep.
 *
 * Asserts the public surface renders cleanly at 375x812 (iPhone 13/14) —
 * the narrowest viewport in the Phase 13 brief's 375/414/768/1024 set.
 * "Cleanly" here means:
 *
 *   1. No horizontal scroll: document scrollWidth <= clientWidth. A page
 *      that wider than the viewport indicates an overflowing fixed-width
 *      child or a missing `flex-wrap` somewhere.
 *
 *   2. Nav search input is visually collapsed (not the desktop width).
 *      The control still exists (kept in the tab order, focusable via the
 *      '/' shortcut) — the test checks it's rendered narrow, not absent.
 *
 *   3. Auth-gated routes (admin, editor) — only checked when the
 *      `E2E_TEST_AUTH_USER_ID` env var enables the shim in
 *      `playwright.config.ts`. Admin pages additionally require
 *      `ADMIN_GITHUB_LOGINS_FOR_E2E` so the moderator check passes.
 *
 * Why a separate spec file: `a11y.spec.ts` runs axe at the default
 * desktop viewport. Re-running it at 375px would double the runtime and
 * the axe ruleset doesn't catch layout overflow anyway. This spec is
 * cheap (just `page.evaluate` calls — no axe) so it can sweep many
 * routes quickly.
 */
import { test, expect, type Page } from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const HAS_ADMIN_LOGIN = !!process.env.ADMIN_GITHUB_LOGINS_FOR_E2E

// iPhone 13/14 portrait — narrowest viewport in the brief.
const MOBILE_VIEWPORT = { width: 375, height: 812 }

test.use({ viewport: MOBILE_VIEWPORT })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walks the document and returns the horizontal overflow in pixels.
 * 0 means the page fits exactly; > 0 means content extends past the
 * right edge of the viewport.
 *
 * `documentElement` rather than `body` because some flex layouts put the
 * scrollable region on `<html>`. Min-clamped to 0 because a sub-pixel
 * sub-zero diff is just rounding noise.
 */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement
    return Math.max(0, doc.scrollWidth - doc.clientWidth)
  })
}

// ---------------------------------------------------------------------------
// Public routes — no auth needed.
// ---------------------------------------------------------------------------

const PUBLIC_ROUTES: Array<{ path: string; label: string }> = [
  { path: '/', label: 'home' },
  { path: '/latest', label: 'latest feed' },
  { path: '/tags', label: 'tags index' },
  // /tag/<slug> may 404 in CI (no seed data); the 404 page is itself part
  // of the public surface we want responsive.
  { path: '/tag/agents', label: 'tag landing' },
  { path: '/search', label: 'search (empty)' },
  { path: '/search?q=agent', label: 'search with query' },
  { path: '/auth/signin', label: 'sign-in' },
  { path: '/auth/blocked', label: 'blocked notice' },
]

for (const { path, label } of PUBLIC_ROUTES) {
  test(`mobile (375px): ${label} (${path}) — no horizontal scroll`, async ({
    page,
  }) => {
    const response = await page.goto(path, { waitUntil: 'load' })
    // Don't gate on status — a 404 still needs to render cleanly.
    expect(response?.status(), `${path} hit a server error`).toBeLessThan(500)

    const overflow = await horizontalOverflow(page)
    expect(
      overflow,
      `${path} overflows horizontally by ${overflow}px at 375px viewport`,
    ).toBeLessThanOrEqual(0)
  })
}

// ---------------------------------------------------------------------------
// Nav search collapses on mobile.
// ---------------------------------------------------------------------------

test('mobile (375px): nav search input is collapsed', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' })

  const input = page.locator('input[name="q"]#nav-search-input')
  await expect(input).toBeAttached()

  // The collapse is :focus-within-driven CSS — measure the unfocused width
  // and assert it's the narrow icon-sized state (CSS sets it to 2.5rem =
  // 40px). Anything > 80px would mean the desktop width leaked in.
  const width = await input.evaluate((el) => el.getBoundingClientRect().width)
  expect(
    width,
    `nav search input is ${width}px wide; expected <= 80px (collapsed)`,
  ).toBeLessThanOrEqual(80)
})

// ---------------------------------------------------------------------------
// Auth-gated routes — only run when the E2E shim is configured.
// ---------------------------------------------------------------------------

test.describe('mobile (375px): auth-gated routes', () => {
  test.skip(!HAS_E2E_AUTH, 'requires E2E_TEST_AUTH_USER_ID')

  test('/write editor stacks vertically with Write/Preview tabs', async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
    await page.goto('/write', { waitUntil: 'load' })

    // Tabs control is visible on mobile.
    const tabs = page.getByTestId('editor-view-tabs')
    await expect(tabs).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Write' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Preview' })).toBeVisible()

    // The drag-divider (only meaningful in the desktop side-by-side
    // layout) is hidden below `lg`.
    await expect(page.getByTestId('split-divider')).toBeHidden()

    const overflow = await horizontalOverflow(page)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('/bookmarks fits within viewport', async ({ page }) => {
    await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
    const response = await page.goto('/bookmarks', { waitUntil: 'load' })
    expect(response?.status()).toBeLessThan(500)

    const overflow = await horizontalOverflow(page)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('/settings/profile fits within viewport', async ({ page }) => {
    await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
    const response = await page.goto('/settings/profile', {
      waitUntil: 'load',
    })
    expect(response?.status()).toBeLessThan(500)

    const overflow = await horizontalOverflow(page)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('mobile (375px): admin tables stack as cards', () => {
  test.skip(
    !HAS_E2E_AUTH || !HAS_ADMIN_LOGIN,
    'requires E2E_TEST_AUTH_USER_ID + ADMIN_GITHUB_LOGINS_FOR_E2E',
  )

  // The four admin routes — each should fit at 375px wide. The two with
  // tables (tags, audit) additionally hide their <table> below md, so we
  // assert the table is not visible.
  for (const path of ['/admin/reports', '/admin/tags', '/admin/users', '/admin/audit']) {
    test(`${path} fits within viewport`, async ({ page }) => {
      await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
      const response = await page.goto(path, { waitUntil: 'load' })
      expect(response?.status()).toBeLessThan(500)

      const overflow = await horizontalOverflow(page)
      expect(overflow).toBeLessThanOrEqual(0)

      // /admin/tags and /admin/audit keep the table in the DOM for md+
      // but mark it `hidden md:block`. At 375px no `<table>` should be
      // rendered visible.
      if (path === '/admin/tags' || path === '/admin/audit') {
        const visibleTableCount = await page
          .locator('table:visible')
          .count()
        expect(
          visibleTableCount,
          `${path} should not render a visible <table> at 375px`,
        ).toBe(0)
      }
    })
  }
})
