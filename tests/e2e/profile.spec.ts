/**
 * Phase 6 profile + settings — E2E tests
 *
 * Auth strategy: same E2E shim as publish.spec.ts / post-page.spec.ts /
 * editor.spec.ts.
 *   - header `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`.
 *   - env `E2E_TEST_AUTH_USER_ID` sets the user ID the bypass returns.
 *
 * DB dependency: ALL scenarios require Supabase. Even the 404 + uppercase
 * redirect paths hit `getCachedProfile()` → `createAnonServerSupabaseClient()`,
 * which throws without `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * We gate every test on `E2E_TEST_AUTH_USER_ID` (same guard the other Phase
 * specs use) so the suite runs locally with a real backend and cleanly skips
 * in CI without secrets.
 *
 * The owner's canonical username isn't known statically (it's whatever
 * public.users row the seeded stub user maps to), so we derive it by creating
 * a post via /api/posts and parsing the `url` field — same trick post-page
 * uses. The owner page (and its settings) is then addressed via that username.
 *
 * Navigation calls use `waitUntil: 'domcontentloaded'` to tolerate fire-and-
 * forget client fetches that can keep the page "loading".
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const SKIP_REASON = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make `page` send the E2E auth shim header on every request. */
async function signIn(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
}

function validPostBody(suffix: string) {
  return {
    type: 'post' as const,
    title: `E2E Profile Post ${suffix}`,
    summary: 'A sufficiently long summary that passes validation.',
    body_md: 'x'.repeat(60),
    tags: ['rag'],
  }
}

/**
 * Create a post as the stub user and return { id, slug, url, username }.
 * The username is the lowercase canonical username of the owner — extracted
 * from the URL, which has shape `/<username>/<type>/<slug>`.
 */
async function createPostAsOwner(
  request: APIRequestContext,
  suffix: string,
): Promise<{ id: string; slug: string; url: string; username: string }> {
  const createRes = await request.post('/api/posts', {
    headers: HEADER_E2E_AUTH,
    data: validPostBody(suffix),
  })
  expect(createRes.status()).toBe(201)
  const body = (await createRes.json()) as { id: string; slug: string; url: string }

  const match = /^\/([^/]+)\/[^/]+\/[^/]+$/.exec(body.url)
  expect(match, `expected url shape /<username>/<type>/<slug>, got ${body.url}`).not.toBeNull()
  const username = match![1]
  expect(username).toBe(username.toLowerCase())

  return { id: body.id, slug: body.slug, url: body.url, username }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Phase 6 profile + settings', () => {
  // -------------------------------------------------------------------------
  // 1. Anon visit to an existing profile → ProfileHeader + post list render
  // -------------------------------------------------------------------------
  test('anonymous visitor to an existing profile sees header + post list', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    // Materialise at least one post so the profile has content to show.
    const { username } = await createPostAsOwner(request, `anon-${Date.now()}`)

    const res = await page.goto(`/${username}`, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // ProfileHeader: display name h1 + @handle.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(`@${username}`)).toBeVisible()

    // Posts section heading is rendered by PostList.
    await expect(
      page.getByRole('heading', { name: 'Posts', level: 2 }),
    ).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 1b. Two-column layout sanity (issue #52): sidebar is the <aside> landmark
  //     and the posts column has filter chips for every post type.
  // -------------------------------------------------------------------------
  test('two-column layout renders sidebar + filter chips', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const { username } = await createPostAsOwner(
      request,
      `layout-${Date.now()}`,
    )

    await page.goto(`/${username}`, { waitUntil: 'domcontentloaded' })

    // The redesigned page wraps identity / actions / stats in an <aside>.
    await expect(page.locator('aside.profile-sidebar')).toBeVisible()

    // Filter chips for every post type live in the main column.
    const filters = page.getByRole('tablist', { name: 'Filter by post type' })
    await expect(filters).toBeVisible()
    for (const label of ['All', 'Posts', 'Playbooks', 'Dives']) {
      await expect(filters.getByRole('tab', { name: label })).toBeVisible()
    }
  })

  // -------------------------------------------------------------------------
  // 1c. Non-owner / anon sees the Follow button instead of Edit Profile.
  //     Anon clicking Follow redirects to /auth/signin with a callbackUrl.
  // -------------------------------------------------------------------------
  test('anon sees Follow button; clicking it redirects to sign-in', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const { username } = await createPostAsOwner(
      request,
      `follow-anon-${Date.now()}`,
    )

    // Visit anonymously — no Edit Profile, Follow button is the primary CTA.
    await page.goto(`/${username}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('link', { name: 'Edit Profile' })).toHaveCount(0)

    const followBtn = page.getByRole('button', { name: `Follow @${username}` })
    await expect(followBtn).toBeVisible()

    // Anon click should bounce through to /auth/signin with this page as
    // the callbackUrl. We click and wait for the URL to settle.
    await followBtn.click()
    await page.waitForURL(/\/auth\/signin/, { timeout: 5000 })
    expect(page.url()).toContain(`callbackUrl=${encodeURIComponent('/' + username)}`)
  })

  // -------------------------------------------------------------------------
  // 2. Owner-only affordances: Edit Profile + Pin buttons appear for owner;
  //    anonymous visitor does not see them.
  // -------------------------------------------------------------------------
  test('owner sees Edit Profile + Pin affordances; non-owner does not', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const { username } = await createPostAsOwner(request, `owner-aff-${Date.now()}`)

    // --- Anonymous: no edit link, no pin button ---
    const anonRes = await page.goto(`/${username}`, { waitUntil: 'domcontentloaded' })
    expect(anonRes?.status()).toBe(200)
    await expect(page.getByRole('link', { name: 'Edit Profile' })).toHaveCount(0)
    await expect(page.locator('button.pin-action')).toHaveCount(0)

    // --- Authed as owner: edit link visible, at least one pin button ---
    await signIn(page)
    const ownerRes = await page.goto(`/${username}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(ownerRes?.status()).toBe(200)
    await expect(page.getByRole('link', { name: 'Edit Profile' })).toBeVisible()
    // Newly-created post starts unpinned, so a Pin button must be present.
    await expect(page.locator('button.pin-action--pin').first()).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 3. Owner pins a post → post appears in the Pinned section on refresh.
  // -------------------------------------------------------------------------
  test('owner pins a post → appears in pinned section', async ({ page, request }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const { id, username } = await createPostAsOwner(
      request,
      `pin-${Date.now()}`,
    )

    // Pin via API to avoid coupling the test to client-side optimistic state.
    const pinRes = await request.post('/api/pinned-posts', {
      headers: HEADER_E2E_AUTH,
      data: { post_id: id },
    })
    expect(pinRes.status()).toBe(201)

    // Visit the owner's profile and assert the Pinned section is rendered
    // and contains a link to the new post.
    await signIn(page)
    await page.goto(`/${username}`, { waitUntil: 'domcontentloaded' })

    const pinnedSection = page.locator('section.profile-pinned')
    await expect(pinnedSection).toBeVisible()
    await expect(
      pinnedSection.getByRole('heading', { name: 'Pinned', level: 2 }),
    ).toBeVisible()

    // The newly-pinned post should be present in the pinned grid.
    await expect(
      pinnedSection.getByRole('link', { name: /E2E Profile Post pin-/ }).first(),
    ).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 4. Owner unpins a post → disappears from the Pinned section.
  // -------------------------------------------------------------------------
  test('owner unpins a post → disappears from pinned section', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const { id, username } = await createPostAsOwner(
      request,
      `unpin-${Date.now()}`,
    )

    // Pin then unpin via API.
    const pinRes = await request.post('/api/pinned-posts', {
      headers: HEADER_E2E_AUTH,
      data: { post_id: id },
    })
    expect(pinRes.status()).toBe(201)

    const unpinRes = await request.delete(`/api/pinned-posts/${id}`, {
      headers: HEADER_E2E_AUTH,
    })
    expect(unpinRes.status()).toBe(200)

    // Visit the profile — the just-unpinned post must not appear in the
    // pinned grid. If no other pins exist, the section itself is hidden.
    await signIn(page)
    await page.goto(`/${username}`, { waitUntil: 'domcontentloaded' })

    const pinnedSection = page.locator('section.profile-pinned')
    // Either the section is absent (no pins remain) OR it's present but the
    // link to this post is not in it.
    const sectionCount = await pinnedSection.count()
    if (sectionCount > 0) {
      await expect(
        pinnedSection.getByRole('link', { name: /unpin-/ }),
      ).toHaveCount(0)
    }
  })

  // -------------------------------------------------------------------------
  // 5. Owner edits bio via /settings/profile → reflects on next profile visit.
  // -------------------------------------------------------------------------
  test('owner edits bio in /settings/profile → reflects on profile page', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    // Resolve username by creating a post (cheap, idempotent setup).
    const { username } = await createPostAsOwner(request, `bio-${Date.now()}`)

    // Use a uniquely-marked bio so we can search for it on the public page.
    const marker = `E2E_BIO_MARKER_${Date.now()}`
    const newBio = `Hello from the e2e suite. ${marker}`

    const patchRes = await request.patch('/api/users/me', {
      headers: HEADER_E2E_AUTH,
      data: { bio: newBio },
    })
    expect(patchRes.status()).toBe(200)

    // Visit /<owner> anonymously — the bio is public.
    const profileRes = await page.goto(`/${username}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(profileRes?.status()).toBe(200)

    // The bio is rendered through `renderBioToHtml` (markdown → HTML) into
    // `.profile-bio`, so the marker text ends up as part of the section's
    // text content.
    await expect(page.locator('.profile-bio')).toContainText(marker)
  })

  // -------------------------------------------------------------------------
  // 6. Unknown username → 404 (Next.js not-found.tsx).
  // -------------------------------------------------------------------------
  test('unknown username returns 404 and renders not-found content', async ({
    page,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    // Use a sufficiently random handle that can never collide with seeded
    // data (and contains no uppercase, so the redirect path is bypassed).
    const handle = `not-a-real-user-${Date.now()}`
    const res = await page.goto(`/${handle}`, { waitUntil: 'domcontentloaded' })

    expect(res?.status()).toBe(404)
    await expect(page.getByText(/page not found/i)).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 7. Uppercase username → permanent redirect (308) to lowercase.
  //
  // `permanentRedirect()` issues 308, but the redirect can also surface as
  // 301 depending on the runtime. We accept either, and assert the final
  // URL settles on the lowercase path.
  // -------------------------------------------------------------------------
  test('uppercase username 3xx-redirects to lowercase canonical URL', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    // Materialise a real user so the redirect TARGET resolves to 200 (rather
    // than 404, which is also acceptable per the brief but less informative).
    const { username } = await createPostAsOwner(
      request,
      `case-${Date.now()}`,
    )
    const upper = username.toUpperCase()

    // Manual no-follow fetch to assert the redirect status + Location header.
    const noFollowRes = await request.get(`/${upper}`, { maxRedirects: 0 })
    const status = noFollowRes.status()
    expect(status, `expected 3xx, got ${status}`).toBeGreaterThanOrEqual(300)
    expect(status).toBeLessThan(400)
    expect([301, 308]).toContain(status)

    const location = noFollowRes.headers()['location']
    expect(location).toBeTruthy()
    // The Location header may be absolute or relative; compare the pathname.
    const locPath = location!.startsWith('http')
      ? new URL(location!).pathname
      : location!
    expect(locPath).toBe(`/${username}`)

    // Sanity-check by browsing (follows redirect) and confirming we land on
    // the lowercase URL with a 200.
    const followed = await page.goto(`/${upper}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(followed?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe(`/${username}`)
  })
})
