import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  test('responds 200 and shows wordmark', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    // Phase 9 moved the wordmark from the (now feed-headlined) <h1> to
    // the nav. Look for it there by accessible name.
    await expect(page.getByRole('link', { name: 'agentlab — home' })).toBeVisible()
  })

  test('theme toggle changes data-theme attribute', async ({ page }) => {
    await page.goto('/')
    const toggle = page.getByTestId('theme-toggle')
    await expect(toggle).toBeVisible()

    // Get initial theme (may be light or dark depending on system)
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    )

    await toggle.click()

    const newTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    )

    // Theme must have changed
    expect(newTheme).not.toBe(initialTheme)
    expect(['light', 'dark']).toContain(newTheme)
  })
})

// ---------------------------------------------------------------------------
// Phase A — Responsive layout: three-column HomeShell
//
// These tests are DB-independent: they inspect CSS visibility of DOM nodes
// only. They do not require Supabase env, auth, or seed data.
// ---------------------------------------------------------------------------

test.describe('HomeShell responsive columns', () => {
  test('xl (1440×900): left sidebar and right sidebar are both visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    // Left aside: hidden below xl, visible at xl
    const leftAside = page.locator('.home-shell__left')
    await expect(leftAside).toBeVisible()

    // Right aside: hidden below lg, visible at lg+
    const rightAside = page.locator('.home-shell__right')
    await expect(rightAside).toBeVisible()
  })

  test('lg (1100×800): left sidebar is hidden; top-nav LeftNav links are visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.goto('/')

    // Left aside should be hidden (xl:hidden means hidden below xl=1280px)
    const leftAside = page.locator('.home-shell__left')
    await expect(leftAside).toBeHidden()

    // Right aside should be visible at lg (hidden lg:block, lg=1024px)
    const rightAside = page.locator('.home-shell__right')
    await expect(rightAside).toBeVisible()

    // LeftNav inside .nav-leftnav should be in the DOM and visible at 1100px
    // (xl:hidden means visible below 1280px)
    const navLeftNav = page.locator('.nav-leftnav')
    await expect(navLeftNav).toBeVisible()

    // Home nav link should be in the top-nav LeftNav
    const homeLink = navLeftNav.getByRole('link', { name: 'Home' })
    await expect(homeLink).toBeVisible()
  })

  test('below lg (800×900): both sidebars are hidden', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/')

    // Left aside: hidden below xl
    const leftAside = page.locator('.home-shell__left')
    await expect(leftAside).toBeHidden()

    // Right aside: hidden below lg (1024px)
    const rightAside = page.locator('.home-shell__right')
    await expect(rightAside).toBeHidden()
  })

  test('phone (390×844): both sidebars hidden; top-nav LeftNav links visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    // Both sidebars must be hidden at phone width
    const leftAside = page.locator('.home-shell__left')
    await expect(leftAside).toBeHidden()

    const rightAside = page.locator('.home-shell__right')
    await expect(rightAside).toBeHidden()

    // The top-nav LeftNav is visible at all widths below xl (spec-locked).
    // "Home" link is a reliable sentinel: no auth required to render it.
    const navLeftNav = page.locator('.nav-leftnav')
    await expect(navLeftNav).toBeVisible()

    const homeLink = navLeftNav.getByRole('link', { name: 'Home' })
    await expect(homeLink).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Phase B: Discovery rails, top-by-type
// Phase C: Risk 1, cache-invalidation drift
//
// These tests are DB-dependent and self-skip without both
// E2E_TEST_AUTH_USER_ID and SUPABASE_SERVICE_ROLE_KEY.
// They follow the existing HAS_E2E_AUTH skip pattern from discovery.spec.ts.
// ---------------------------------------------------------------------------

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const HAS_SERVICE_KEY = !!process.env.SUPABASE_SERVICE_ROLE_KEY

test.describe('Phase B — Discovery rails (xl layout)', () => {
  test.skip(
    !HAS_E2E_AUTH || !HAS_SERVICE_KEY,
    'requires E2E_TEST_AUTH_USER_ID + SUPABASE_SERVICE_ROLE_KEY',
  )

  test('xl (1440×900): top-playbooks and top-dives rails in right sidebar', async ({
    page,
    request,
  }) => {
    // Seed a playbook and a dive so the rails have something to show.
    const suffix = String(Date.now())
    const PLAYBOOK_BODY = [
      '## Environment Target',
      'Node.js 20',
      '## Prerequisites',
      'None.',
      '## Core Instructions',
      'Step 1.',
      '## Safety and Failure Modes',
      'None.',
    ].join('\n\n')
    await request.post('/api/posts', {
      headers: { 'x-e2e-auth': '1' },
      data: {
        type: 'playbook',
        title: `Top Playbook ${suffix}`,
        summary: 'Seeded playbook for top-by-type test.',
        body_md: PLAYBOOK_BODY,
        tags: ['security'],
      },
    })

    const DIVE_BODY = [
      '## TL;DR',
      'Brief summary.',
      '## The Question',
      'What is X?',
    ].join('\n\n')
    await request.post('/api/posts', {
      headers: { 'x-e2e-auth': '1' },
      data: {
        type: 'dive',
        title: `Top Dive ${suffix}`,
        summary: 'Seeded dive for top-by-type test.',
        body_md: DIVE_BODY,
        tags: ['evals'],
      },
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const rightAside = page.locator('.home-shell__right')
    await expect(rightAside).toBeVisible()

    // No error boundary should be visible.
    await expect(page.locator('text=Something went wrong')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// Phase C — Risk 1: cache-invalidation drift
//
// THE LINCHPIN TEST: publishing a post via POST /api/posts should invalidate
// the discovery-cache immediately (revalidateTag('posts', { expire: 0 })),
// so the VERY NEXT request to '/' re-queries rather than serving a stale
// 600s TTL. The top-by-type rail must reflect the new post without waiting
// for the TTL to expire.
// ---------------------------------------------------------------------------

test.describe('Phase C — Risk 1: cache-invalidation drift', () => {
  test.skip(
    !HAS_E2E_AUTH || !HAS_SERVICE_KEY,
    'requires E2E_TEST_AUTH_USER_ID + SUPABASE_SERVICE_ROLE_KEY',
  )

  test('publishing a post immediately invalidates the discovery cache on next request', async ({
    page,
    request,
  }) => {
    const suffix = String(Date.now())

    // Set xl viewport once — all assertions in this test require the right
    // sidebar (top-by-type rails) to be visible.
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // ---------------------------------------------------------------------------
    // Step 1: seed a playbook to test the top-by-type rail invalidation.
    //
    // POST /api/posts calls revalidateTag('posts', { expire: 0 }) immediately
    // after the insert, so the VERY NEXT request to '/' re-queries the cache
    // instead of serving the stale 600-second TTL.
    //
    // The playbook title must be unique (suffix-stamped) so the assertion is
    // unambiguous: we can be certain the link we find is the one we seeded.
    // ---------------------------------------------------------------------------
    const PLAYBOOK_BODY = [
      '## Environment Target',
      'Node.js 20',
      '## Prerequisites',
      'None.',
      '## Core Instructions',
      'Step 1.',
      '## Safety and Failure Modes',
      'None.',
    ].join('\n\n')

    const playbookTitle = `Cache Invalidation Playbook ${suffix}`
    const playbookRes = await request.post('/api/posts', {
      headers: { 'x-e2e-auth': '1' },
      data: {
        type: 'playbook',
        title: playbookTitle,
        summary: 'Seeded playbook for cache-invalidation test.',
        body_md: PLAYBOOK_BODY,
        tags: ['security'],
      },
    })
    expect(playbookRes.status()).toBe(201)
    const { id: playbookId } = (await playbookRes.json()) as { id: string }

    try {
      // ---------------------------------------------------------------------------
      // Step 2: load '/' (the VERY NEXT request post-invalidation).
      // ---------------------------------------------------------------------------
      const homeRes = await page.goto('/', { waitUntil: 'domcontentloaded' })
      expect(homeRes?.status()).toBe(200)

      // No error boundary should be visible regardless of cache state.
      await expect(page.locator('text=Something went wrong')).toHaveCount(0)

      // The left sidebar (xl) must be visible at 1440px.
      const leftAside = page.locator('.home-shell__left')
      await expect(leftAside).toBeVisible()

      // The right sidebar must be visible at xl.
      const rightAside = page.locator('.home-shell__right')
      await expect(rightAside).toBeVisible()

      // The home-feed shell must be intact.
      await expect(page.locator('main.home-feed')).toBeVisible()

      // ---------------------------------------------------------------------------
      // LINCHPIN: The top-playbooks rail must contain the newly published
      // playbook. The section is `section[aria-labelledby="top-playbook-heading"]`
      // inside `.home-shell__right`. The unique title guarantees this is OUR
      // playbook, not a pre-existing one. This assertion FAILS if
      // revalidateTag('posts', ...) is absent, since the stale cache would not
      // include the just-published playbook for up to 600s.
      // ---------------------------------------------------------------------------
      const playbooksRail = page.locator(
        '.home-shell__right section[aria-labelledby="top-playbook-heading"]',
      )
      await expect(playbooksRail).toBeVisible({ timeout: 10_000 })
      await expect(playbooksRail.getByRole('link', { name: playbookTitle })).toBeVisible()
    } finally {
      // --- Cleanup: delete the seeded playbook ---
      await request.delete(`/api/posts/${playbookId}`, {
        headers: { 'x-e2e-auth': '1' },
      }).catch(() => undefined)
    }
  })
})
