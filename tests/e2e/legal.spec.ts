/**
 * E2E coverage for the single /terms route (Phase 3 legal consolidation).
 *
 * Hits the route anonymously and asserts:
 *   - 200 response
 *   - <h1> matches the registry title
 *   - Last-updated stamp is present
 *   - JSON-LD WebPage schema block is present
 *   - Footer link resolves (no 404)
 *   - The four retired legal URLs 308-redirect to /terms
 */
import { test, expect } from '@playwright/test'

const TERMS = { slug: 'terms', path: '/terms', title: 'Terms and Privacy' }

test('/terms: renders with H1, last-updated, and JSON-LD', async ({
  page,
}) => {
  const response = await page.goto(TERMS.path)
  expect(response?.status()).toBe(200)

  // <h1> matches the registry title.
  await expect(page.locator('main h1').first()).toHaveText(TERMS.title)

  // Page title runs through the root layout template.
  await expect(page).toHaveTitle(`${TERMS.title} — agentlab.in`)

  // Last-updated stamp present and ISO-shaped.
  const stamp = page.locator('main time[datetime]').first()
  await expect(stamp).toBeVisible()
  const iso = await stamp.getAttribute('datetime')
  expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  // JSON-LD block present, parses, declares the right URL.
  const jsonLdRaw = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent()
  expect(jsonLdRaw).toBeTruthy()
  const jsonLd = JSON.parse(jsonLdRaw!)
  expect(jsonLd['@type']).toBe('WebPage')
  expect(jsonLd.url).toContain(`/${TERMS.slug}`)
})

test('Footer exposes the single terms route with no 404s', async ({
  page,
  request,
}) => {
  await page.goto('/')
  const footer = page.locator('footer').first()
  await expect(footer).toBeVisible()

  const hrefs = await footer.locator('a').evaluateAll((els) =>
    els.map((el) => (el as HTMLAnchorElement).getAttribute('href')),
  )

  expect(hrefs).toContain('/terms')

  // None of the retired slugs should still be wired up in the footer.
  for (const slug of ['privacy', 'policy', 'grievance', 'dmca', 'content-policy', 'copyright']) {
    expect(hrefs).not.toContain(`/${slug}`)
  }

  // Every footer link resolves (200, no 404).
  for (const href of hrefs) {
    if (!href || !href.startsWith('/')) continue
    const res = await request.get(href)
    expect(res.status(), `footer link ${href} did not 200`).toBe(200)
  }
})

test.describe('retired legal URLs redirect to /terms', () => {
  for (const path of ['/privacy', '/policy', '/grievance', '/dmca']) {
    test(`${path} permanently redirects to /terms`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status()).toBe(308)
      expect(response.headers()['location']).toContain('/terms')
    })
  }
})

test('deprecated /content-policy slug is no longer routed', async ({
  page,
}) => {
  const response = await page.goto('/content-policy')
  // The slug stays in lib/reserved-names.ts (so it can't be claimed
  // as a username), but no redirect was added for it (only the four
  // listed in Phase 3 were). Canonical home is /terms.
  expect(response?.status()).toBe(404)
})
