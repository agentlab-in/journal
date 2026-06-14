import { test, expect } from '@playwright/test'

/**
 * perf/page-load — page-load timing budget.
 *
 * Why opt-in (PERF_BUDGET=1) instead of an always-on CI gate:
 *
 *   - CI boots `pnpm dev` (unoptimised) with placeholder Supabase
 *     (`*.invalid`), so feed pages render the empty state and never
 *     exercise the real DB path. A wall-clock budget there would measure
 *     dev-server overhead against no data — flaky and meaningless.
 *   - The brief's budget (~500ms server-side) targets a production-like
 *     surface. Point this spec at one with
 *     `PERF_BUDGET=1 PERF_BASE_URL=https://<preview>.vercel.app`.
 *
 * It is the repeatable "re-run Stage 1 timing capture" tool: it records
 * navigation timing for the home and post surfaces and asserts each stays
 * under `PERF_BUDGET_MS` (default 1500ms total nav, generous to absorb the
 * cross-region hop the code fixes can't remove). Set a tighter value to
 * enforce a stricter SSR budget on a warm, same-region surface.
 */

const ENABLED = process.env.PERF_BUDGET === '1'
const BASE = process.env.PERF_BASE_URL // optional external target (preview/prod)
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS ?? '1500')

// Navigation timing: ms from request start to the response's first byte
// (server think-time + network) and to DOMContentLoaded.
async function captureTiming(page: import('@playwright/test').Page, path: string) {
  const url = BASE ? new URL(path, BASE).toString() : path
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return page.evaluate(() => {
    const nav = performance.getEntriesByType(
      'navigation',
    )[0] as PerformanceNavigationTiming
    return {
      ttfb: Math.round(nav.responseStart - nav.requestStart),
      domContentLoaded: Math.round(
        nav.domContentLoadedEventStart - nav.startTime,
      ),
    }
  })
}

test.describe('page-load timing budget', () => {
  test.skip(!ENABLED, 'opt-in: set PERF_BUDGET=1 (and PERF_BASE_URL for a real surface)')

  test('home (/) loads within budget', async ({ page }) => {
    const t = await captureTiming(page, '/')
    console.log(`[perf] / ttfb=${t.ttfb}ms dcl=${t.domContentLoaded}ms`)
    expect(t.domContentLoaded).toBeLessThan(BUDGET_MS)
  })

  test('latest (/latest) loads within budget', async ({ page }) => {
    const t = await captureTiming(page, '/latest')
    console.log(`[perf] /latest ttfb=${t.ttfb}ms dcl=${t.domContentLoaded}ms`)
    expect(t.domContentLoaded).toBeLessThan(BUDGET_MS)
  })
})
