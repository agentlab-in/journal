/**
 * Axe-core a11y check for /settings/profile — the redesigned (issue #50)
 * surface. Lives in its own file rather than tests/e2e/a11y.spec.ts because
 * the route is auth-gated: we have to seat the `x-e2e-auth: 1` header on
 * the Playwright page BEFORE navigation so lib/auth's E2E bypass returns a
 * real user. Same gate + skip pattern as profile.spec.ts so CI without
 * E2E auth env passes cleanly.
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }
const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const SKIP_REASON = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'

async function runAxe(page: import('@playwright/test').Page) {
  await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
  const response = await page.goto('/settings/profile', { waitUntil: 'load' })
  expect(response?.status(), '/settings/profile responded with a server error').toBeLessThan(
    500,
  )

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )

  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (v) =>
          `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`,
      )
      .join('\n')
    throw new Error(`Axe found serious/critical violations on /settings/profile:\n${summary}`)
  }
}

test('a11y: /settings/profile (light) — zero serious/critical violations', async ({ page }) => {
  test.skip(!HAS_E2E_AUTH, SKIP_REASON)
  await runAxe(page)
})

test('a11y (dark): /settings/profile — zero serious/critical violations', async ({ page }) => {
  test.skip(!HAS_E2E_AUTH, SKIP_REASON)
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('theme', 'dark')
    } catch {
      // fall through
    }
  })
  await runAxe(page)
})
