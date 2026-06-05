/**
 * E2E coverage for the five legal routes wired in feat/legal-routes.
 *
 * Hits each route anonymously and asserts:
 *   - 200 response
 *   - <h1> matches the registry title
 *   - Last-updated stamp is present
 *   - Cross-doc nav exposes the other four pages
 *   - JSON-LD WebPage schema block is present
 *   - Footer links resolve (no 404s) for every visible href
 */
import { test, expect } from '@playwright/test'

const LEGAL_ROUTES: Array<{ slug: string; path: string; title: string }> = [
  { slug: 'privacy', path: '/privacy', title: 'Privacy Policy' },
  { slug: 'terms', path: '/terms', title: 'Terms of Service' },
  { slug: 'policy', path: '/policy', title: 'Content Policy' },
  { slug: 'grievance', path: '/grievance', title: 'Grievance Officer Notice' },
  { slug: 'dmca', path: '/dmca', title: 'Copyright Takedown Policy' },
]

for (const { slug, path, title } of LEGAL_ROUTES) {
  test(`/${slug}: renders with H1, last-updated, and cross-doc nav`, async ({
    page,
  }) => {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)

    // <h1> matches the registry title.
    await expect(page.locator('main h1').first()).toHaveText(title)

    // Page title runs through the root layout template.
    await expect(page).toHaveTitle(`${title} — agentlab.in`)

    // Last-updated stamp present and ISO-shaped.
    const stamp = page.locator('main time[datetime]').first()
    await expect(stamp).toBeVisible()
    const iso = await stamp.getAttribute('datetime')
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Cross-doc nav surfaces the other four legal pages.
    const nav = page.locator('nav[aria-label="Other legal pages"]')
    await expect(nav).toBeVisible()
    const navLinks = await nav.locator('a').count()
    expect(navLinks).toBe(LEGAL_ROUTES.length - 1)

    // JSON-LD block present, parses, declares the right URL.
    const jsonLdRaw = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent()
    expect(jsonLdRaw).toBeTruthy()
    const jsonLd = JSON.parse(jsonLdRaw!)
    expect(jsonLd['@type']).toBe('WebPage')
    expect(jsonLd.url).toContain(`/${slug}`)
  })
}

test('Footer exposes all five legal routes with no 404s', async ({
  page,
  request,
}) => {
  await page.goto('/')
  const footer = page.locator('footer').first()
  await expect(footer).toBeVisible()

  const hrefs = await footer.locator('a').evaluateAll((els) =>
    els.map((el) => (el as HTMLAnchorElement).getAttribute('href')),
  )

  // Footer must surface the canonical five slugs.
  for (const slug of ['privacy', 'terms', 'policy', 'grievance', 'dmca']) {
    expect(hrefs).toContain(`/${slug}`)
  }

  // None of the deprecated slugs should still be wired up.
  expect(hrefs).not.toContain('/content-policy')
  expect(hrefs).not.toContain('/copyright')

  // Every footer link resolves (200, no 404).
  for (const href of hrefs) {
    if (!href || !href.startsWith('/')) continue
    const res = await request.get(href)
    expect(res.status(), `footer link ${href} did not 200`).toBe(200)
  }
})

test('deprecated /content-policy slug is no longer routed', async ({
  page,
}) => {
  const response = await page.goto('/content-policy')
  // The slug stays in lib/reserved-names.ts (so it can't be claimed
  // as a username), but the route itself should not resolve any more —
  // canonical home is /policy.
  expect(response?.status()).toBe(404)
})
