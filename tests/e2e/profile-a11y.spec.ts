/**
 * Axe-core a11y check for /[username] — the redesigned (issue #52) public
 * profile. Lives in its own file rather than tests/e2e/a11y.spec.ts because
 * the route needs a real profile to render meaningfully, and we resolve the
 * canonical username by creating a post through the E2E auth shim (same
 * trick profile.spec.ts uses). Gated on E2E_TEST_AUTH_USER_ID so CI without
 * the auth env skips cleanly, matching settings-profile-a11y.spec.ts.
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }
const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const SKIP_REASON = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'

async function resolveOwnerUsername(request: APIRequestContext): Promise<string> {
  // Materialise one post so the profile has content + we can extract the
  // canonical lowercase username from the returned post URL.
  const createRes = await request.post('/api/posts', {
    headers: HEADER_E2E_AUTH,
    data: {
      type: 'post' as const,
      title: `E2E Profile A11y ${Date.now()}`,
      summary: 'A sufficiently long summary that passes validation.',
      body_md: 'x'.repeat(60),
      tags: ['rag'],
    },
  })
  expect(createRes.status()).toBe(201)
  const body = (await createRes.json()) as { url: string }
  const match = /^\/([^/]+)\/[^/]+\/[^/]+$/.exec(body.url)
  expect(match).not.toBeNull()
  return match![1]
}

async function runAxe(
  page: import('@playwright/test').Page,
  username: string,
) {
  const response = await page.goto(`/${username}`, { waitUntil: 'load' })
  expect(response?.status(), `/${username} responded with a server error`).toBeLessThan(500)

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
    throw new Error(`Axe found serious/critical violations on /${username}:\n${summary}`)
  }
}

test('a11y: /[username] (light) — zero serious/critical violations', async ({
  page,
  request,
}) => {
  test.skip(!HAS_E2E_AUTH, SKIP_REASON)
  const username = await resolveOwnerUsername(request)
  await runAxe(page, username)
})

test('a11y (dark): /[username] — zero serious/critical violations', async ({
  page,
  request,
}) => {
  test.skip(!HAS_E2E_AUTH, SKIP_REASON)
  const username = await resolveOwnerUsername(request)
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('theme', 'dark')
    } catch {
      // fall through
    }
  })
  await runAxe(page, username)
})
