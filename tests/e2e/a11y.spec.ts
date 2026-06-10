import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Axe-core a11y checks across every public route.
 *
 * Spec: Phase 13 — target zero serious/critical violations on the public
 * surface. Auth-gated routes (/write, /bookmarks, /admin/*, /settings/*)
 * are skipped in CI because the E2E auth shim only activates with the
 * `x-e2e-auth: 1` header, which Playwright's `page.goto` doesn't send.
 * They're covered by their own per-feature E2E specs.
 */

const PUBLIC_ROUTES: Array<{ path: string; label: string }> = [
  { path: '/', label: 'home' },
  { path: '/latest', label: 'latest feed' },
  { path: '/trending', label: 'trending feed' },
  { path: '/tags', label: 'tags index' },
  { path: '/tag/agents', label: 'tag landing (likely empty)' },
  { path: '/search', label: 'search (empty)' },
  { path: '/search?q=agent', label: 'search with query' },
  { path: '/auth/signin', label: 'sign-in' },
  { path: '/auth/blocked', label: 'blocked notice' },
  { path: '/auth/consent-declined', label: 'consent declined' },
  { path: '/privacy', label: 'privacy policy' },
  { path: '/terms', label: 'terms of service' },
  { path: '/policy', label: 'content policy' },
  { path: '/grievance', label: 'grievance officer notice' },
  { path: '/dmca', label: 'copyright takedown policy' },
]

// Phase 13 dark-mode audit: axe defaults to whichever theme the headless
// runner's prefers-color-scheme yields (usually light). Duplicate the
// sweep with `data-theme="dark"` forced before the run so contrast
// regressions in the dark palette can't slip through. We use addInitScript
// to set localStorage AND the data-theme attribute pre-paint, so the
// inline theme script in app/layout.tsx picks it up on the very first
// frame and axe sees a fully-themed page.
async function forceDarkTheme(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('theme', 'dark')
    } catch {
      // Storage blocked — fall through; the inline layout script will
      // still honour data-theme if something else sets it.
    }
  })
}

for (const { path, label } of PUBLIC_ROUTES) {
  test(`a11y: ${label} (${path}) — zero serious/critical violations`, async ({ page }) => {
    // Wait for `load` so the React-Server-Components payload finishes
    // streaming and React rehydrates the document. With `domcontentloaded`
    // axe could fire before Next.js's dev shell upgrades `<html id="__next_error__">`
    // (no lang) to the real `<html lang="en">` from the root layout.
    const response = await page.goto(path, { waitUntil: 'load' })
    // Tag/profile routes may 404 when seed data is absent — axe still runs on the 404 page,
    // which is itself part of the surface we want clean.
    expect(response?.status(), `${path} responded with a server error`).toBeLessThan(500)

    // Belt-and-suspenders: explicitly wait for the lang attribute to land
    // on <html>. On a fully-rendered page this resolves instantly; on the
    // 404 fallback we give React up to 2s to swap in the layout.
    await page.waitForFunction(() => document.documentElement.lang === 'en', null, {
      timeout: 2000,
    }).catch(() => {
      // If it still hasn't shown up, fall through — axe will flag it and
      // the failure is a real signal worth investigating.
    })

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )

    if (blocking.length > 0) {
      const summary = blocking
        .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`)
        .join('\n')
      throw new Error(`Axe found serious/critical violations on ${path}:\n${summary}`)
    }
  })

  test(`a11y (dark): ${label} (${path}) — zero serious/critical violations`, async ({ page }) => {
    await forceDarkTheme(page)
    const response = await page.goto(path, { waitUntil: 'load' })
    expect(response?.status(), `${path} responded with a server error`).toBeLessThan(500)

    // Pre-hydration script reads localStorage and sets data-theme. Wait
    // for it to land so axe's color-contrast pass measures the dark
    // palette rather than the default light one.
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-theme') === 'dark',
      null,
      { timeout: 2000 },
    ).catch(() => {
      // Fall through — axe will still run on whatever theme settled.
    })

    await page.waitForFunction(() => document.documentElement.lang === 'en', null, {
      timeout: 2000,
    }).catch(() => {})

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )

    if (blocking.length > 0) {
      const summary = blocking
        .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`)
        .join('\n')
      throw new Error(`Axe (dark) found serious/critical violations on ${path}:\n${summary}`)
    }
  })
}
