/**
 * Theme persistence E2E — Phase 13 dark-mode audit.
 *
 * Covers the two persistence contracts the audit introduced:
 *   1. Toggling the theme writes `theme` to localStorage AND flips the
 *      `data-theme` attribute on <html>.
 *   2. Navigating to another route preserves the chosen theme (i.e. the
 *      pre-hydration script in app/layout.tsx reads localStorage on each
 *      page load and seeds <html data-theme> before paint, avoiding the
 *      light-to-dark flash on a returning visitor).
 *
 * The site renders fine without a Supabase backend, so this spec runs
 * against the public surface (/, /latest) and doesn't need seed data.
 */
import { test, expect } from '@playwright/test'

test.describe('Theme persistence', () => {
  test('toggling theme flips data-theme and writes to localStorage', async ({
    page,
  }) => {
    await page.goto('/')

    // Resolve whatever theme the pre-hydration script settled on (could
    // be either, depending on the test runner's prefers-color-scheme).
    const initial = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    )
    expect(initial === 'light' || initial === 'dark').toBe(true)

    const expected = initial === 'light' ? 'dark' : 'light'
    await page.getByTestId('theme-toggle').click()

    const after = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    )
    expect(after).toBe(expected)

    const stored = await page.evaluate(() => window.localStorage.getItem('theme'))
    expect(stored).toBe(expected)
  })

  test('chosen theme persists across navigation', async ({ page }) => {
    await page.goto('/')

    // Force dark so the test has a deterministic target regardless of
    // the runner's prefers-color-scheme.
    await page.evaluate(() => window.localStorage.setItem('theme', 'dark'))
    await page.goto('/')
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      ),
    ).toBe('dark')

    // Navigate to /latest — pre-hydration script must re-apply 'dark'
    // before React mounts, so there's never a frame of 'light'.
    await page.goto('/latest')
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      ),
    ).toBe('dark')

    // And the toggle still reads the persisted value (label is the
    // inverse — i.e. "light" when current theme is dark).
    await expect(page.getByTestId('theme-toggle')).toHaveText('light')
  })
})
