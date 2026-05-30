/**
 * Polish details E2E — Phase 13 Section 8.
 *
 * Asserts the user-visible polish contracts:
 *   1. Title format is consistent across the public surface:
 *      - Home is `'agentlab.in'` (site name only).
 *      - Other public pages resolve to `'{label} — agentlab.in'`.
 *   2. The prefers-color-scheme favicon variants are wired into <head>.
 *
 * Public-surface routes only — no auth, no Supabase seed data needed.
 */
import { test, expect } from '@playwright/test'

test.describe('Phase 13 polish — title format', () => {
  test('home page title is the bare site name (no em-dash suffix)', async ({
    page,
  }) => {
    await page.goto('/')
    // Bare site name on the home route. `title.absolute` in app/page.tsx
    // bypasses the layout-level `'%s — agentlab.in'` template.
    await expect(page).toHaveTitle('agentlab.in')
  })

  test('/latest title ends with " — agentlab.in"', async ({ page }) => {
    await page.goto('/latest')
    const title = await page.title()
    expect(title).toBe('Latest — agentlab.in')
    // Defensive: no double em-dash, no trailing whitespace.
    expect(title).not.toContain('— —')
    expect(title.trim()).toBe(title)
  })

  test('/tags title ends with " — agentlab.in"', async ({ page }) => {
    await page.goto('/tags')
    const title = await page.title()
    expect(title).toBe('All tags — agentlab.in')
    expect(title.trim()).toBe(title)
  })

  test('/search title ends with " — agentlab.in"', async ({ page }) => {
    await page.goto('/search')
    const title = await page.title()
    expect(title).toBe('Search — agentlab.in')
    expect(title.trim()).toBe(title)
  })
})

test.describe('Phase 13 polish — favicon variants', () => {
  test('document head exposes light + dark icon links with media queries', async ({
    page,
  }) => {
    await page.goto('/')

    // Two <link rel="icon"> tags with prefers-color-scheme media queries
    // so browsers pick the right contrast for the user's OS theme.
    const lightHref = await page
      .locator('link[rel="icon"][media="(prefers-color-scheme: light)"]')
      .first()
      .getAttribute('href')
    expect(lightHref).toContain('/icon-light.png')

    const darkHref = await page
      .locator('link[rel="icon"][media="(prefers-color-scheme: dark)"]')
      .first()
      .getAttribute('href')
    expect(darkHref).toContain('/icon-dark.png')
  })

  test('apple-touch-icon is served from the file-convention apple-icon', async ({
    page,
  }) => {
    await page.goto('/')
    // app/apple-icon.png is auto-registered by the Next 16 file-convention
    // and emits a <link rel="apple-touch-icon"> tag.
    const appleHref = await page
      .locator('link[rel="apple-touch-icon"]')
      .first()
      .getAttribute('href')
    expect(appleHref).toBeTruthy()
    expect(appleHref).toMatch(/apple-icon/)
  })
})
