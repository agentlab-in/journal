/**
 * Keyboard navigation E2E — Phase 13.
 *
 * Covers the four shortcuts that Phase 13 ships:
 *   - '/' focuses the nav search input (unless typing in another field)
 *   - 'j' / 'k' traverse the feed; Enter opens the focused card
 *   - skip-to-content link is reachable from page top via Tab
 *
 * The j/k/Enter test depends on at least one PostCard rendering on
 * `/latest`. In CI the Supabase env is a placeholder, so the feed query
 * degrades to an empty list — we skip the test in that case rather than
 * fail. The presence of a card is checked first; absence => skip.
 *
 * The report-modal Esc scenario is covered by the existing ReportModal
 * unit test paths plus the per-route a11y spec; opening the modal here
 * requires an authed session AND a real post, both of which the CI
 * Supabase placeholder cannot satisfy. Documented as a deliberate skip
 * rather than a TODO.
 */
import { test, expect } from '@playwright/test'

test.describe('Keyboard navigation', () => {
  test("'/' focuses the nav search input on /", async ({ page }) => {
    await page.goto('/')

    // Press '/' with no modifier — the listener should grab it and
    // focus the search input.
    await page.keyboard.press('/')

    const focusedId = await page.evaluate(
      () => document.activeElement?.id ?? null,
    )
    expect(focusedId).toBe('nav-search-input')
  })

  test("'/' does not steal focus when typing in another input", async ({
    page,
  }) => {
    await page.goto('/search')

    // Type into the search-page input (a different element from the nav
    // input). '/' inside an input should NOT re-focus the nav input.
    const pageInput = page.locator('input[name="q"]').first()
    await pageInput.focus()
    await page.keyboard.type('agent/something')

    // The focus must still be on the page input, not the nav input.
    const focusedName = await page.evaluate(() => {
      const a = document.activeElement
      return a instanceof HTMLInputElement ? a.name : null
    })
    expect(focusedName).toBe('q')
  })

  test("'j' then 'k' traverse cards on /latest; Enter opens", async ({
    page,
  }) => {
    await page.goto('/latest')

    // The CI Supabase placeholder makes /latest empty. Skip when so —
    // the j/k handler is still wired and the unit path exercises the
    // wrapper logic.
    const cardCount = await page.locator('[data-feed-card]').count()
    test.skip(cardCount < 2, 'Need at least 2 cards on /latest to exercise j/k')

    // j focuses the first card.
    await page.keyboard.press('j')
    const firstHref = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-href'),
    )
    expect(firstHref).not.toBeNull()

    // j again advances to the second card.
    await page.keyboard.press('j')
    const secondHref = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-href'),
    )
    expect(secondHref).not.toBeNull()
    expect(secondHref).not.toBe(firstHref)

    // k goes back to the first.
    await page.keyboard.press('k')
    const backHref = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-href'),
    )
    expect(backHref).toBe(firstHref)

    // Enter navigates to that card.
    await page.keyboard.press('Enter')
    await page.waitForURL((url) => url.pathname === firstHref, {
      timeout: 5_000,
    })
  })

  test('Tab from the top reveals the skip-to-content link', async ({ page }) => {
    await page.goto('/')

    // Reset focus to the document body so Tab lands on the first
    // focusable element (the skip link).
    await page.evaluate(() => {
      const a = document.activeElement
      if (a instanceof HTMLElement) a.blur()
    })

    await page.keyboard.press('Tab')

    const link = page.locator('a.skip-to-content')
    await expect(link).toBeFocused()
    // It must actually be visible (not just sr-only) when focused.
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '#main-content')
  })
})
