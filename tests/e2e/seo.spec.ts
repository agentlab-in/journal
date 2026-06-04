/**
 * SEO routes — sitemap.xml + robots.txt + Atom feeds.
 *
 * robots.txt is static (no DB), so it always runs.
 * sitemap.xml + feed routes need DB to surface real posts — gated on
 * E2E_TEST_AUTH_USER_ID, same as post-page.spec.ts.
 */
import { test, expect } from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }
const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const SKIP_REASON = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'

test.describe('SEO routes', () => {
  test('GET /robots.txt returns a parseable robots file referencing the sitemap', async ({
    request,
  }) => {
    const res = await request.get('/robots.txt')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('User-Agent: *')
    // Phase 14 / H8: production robots only Disallows /api/. The admin/
    // write/settings/auth paths are protected at the handler and are
    // intentionally omitted so robots.txt isn't a sitemap of sensitive
    // surfaces.
    expect(body).toContain('Disallow: /api/')
    expect(body).not.toContain('Disallow: /admin')
    expect(body).toContain('Sitemap: https://agentlab.in/sitemap.xml')
  })

  test('GET /sitemap.xml returns an XML urlset', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type'] ?? '').toContain('xml')
    const body = await res.text()
    expect(body).toContain('<urlset')
  })

  test('GET /sitemap.xml includes a freshly-created post URL', async ({ request }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: {
        type: 'post',
        title: `E2E Sitemap Post ${suffix}`,
        summary: 'A sufficiently long summary that passes validation.',
        body_md: 'x'.repeat(60),
        tags: ['rag'],
      },
    })
    expect(createRes.status()).toBe(201)
    const { url } = (await createRes.json()) as { url: string }

    const res = await request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain(url)
  })

  // -------------------------------------------------------------------------
  // Atom feeds
  // -------------------------------------------------------------------------

  test('GET /feed.xml returns an Atom feed', async ({ request }) => {
    const res = await request.get('/feed.xml')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type'] ?? '').toContain('application/atom+xml')
    const body = await res.text()
    expect(body.startsWith('<?xml')).toBe(true)
    expect(body).toContain('<feed')
  })

  test('GET /tag/nonexistent-xyz/feed.xml returns 404', async ({ request }) => {
    // Service-role lookup yields null → 404, even when Supabase env is missing
    // (the query fails → null → 404), so this works in CI without auth env.
    const res = await request.get('/tag/nonexistent-xyz-no-such-tag/feed.xml')
    expect(res.status()).toBe(404)
  })

  test('GET /<username>/feed.xml contains the seeded post title', async ({
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const title = `E2E Feed Post ${suffix}`
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: {
        type: 'post',
        title,
        summary: 'A sufficiently long summary that passes validation.',
        body_md: 'x'.repeat(60),
        tags: ['rag'],
      },
    })
    expect(createRes.status()).toBe(201)
    const { url } = (await createRes.json()) as { url: string }
    // url is absolute: https://agentlab.in/<username>/post/<slug>
    const path = new URL(url).pathname
    const username = path.split('/').filter(Boolean)[0]

    const res = await request.get(`/${username}/feed.xml`)
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('<feed')
    expect(body).toContain(title)
  })

  test('GET /tag/rag/feed.xml returns a feed wrapper', async ({ request }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    // `rag` is the default tag used across post-page.spec.ts seeds.
    const res = await request.get('/tag/rag/feed.xml')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('<feed')
  })

  // -------------------------------------------------------------------------
  // JSON-LD structured data
  // -------------------------------------------------------------------------

  test('post page emits Article JSON-LD with the post title', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const postBody = {
      type: 'post' as const,
      title: `E2E JSON-LD Post ${suffix}`,
      summary: 'A sufficiently long summary that passes validation.',
      body_md: 'x'.repeat(60),
      tags: ['rag'],
    }

    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: postBody,
    })
    expect(createRes.status()).toBe(201)
    const { url } = (await createRes.json()) as { url: string }
    const path = new URL(url).pathname

    await page.goto(path, { waitUntil: 'domcontentloaded' })

    const ld = page.locator('script[type="application/ld+json"]').first()
    await expect(ld).toHaveCount(1)
    const raw = (await ld.textContent()) ?? ''
    const parsed = JSON.parse(raw) as { '@type': string; headline: string }
    expect(['Article', 'TechArticle']).toContain(parsed['@type'])
    expect(parsed.headline).toBe(postBody.title)
  })

  // -------------------------------------------------------------------------
  // Per-post OG image (next/og ImageResponse)
  // -------------------------------------------------------------------------

  test('GET /<username>/<type>/<slug>/opengraph-image returns a PNG', async ({
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: {
        type: 'post',
        title: `E2E OG Post ${suffix}`,
        summary: 'A sufficiently long summary that passes validation.',
        body_md: 'x'.repeat(60),
        tags: ['rag'],
      },
    })
    expect(createRes.status()).toBe(201)
    const { url } = (await createRes.json()) as { url: string }
    const path = new URL(url).pathname

    const res = await request.get(`${path}/opengraph-image`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type'] ?? '').toContain('image/png')
    const body = await res.body()
    // A real Satori-rendered PNG is tens of KB; 1 KB rules out a
    // stub/error body without coupling the test to exact byte counts.
    expect(body.byteLength).toBeGreaterThan(1000)
  })

  test('GET /unknown/post/unknown/opengraph-image redirects to /og.png', async ({
    request,
  }) => {
    // No DB needed: the cached-post lookup either returns null or
    // throws when Supabase env is unset; either path is caught and
    // redirected to the static fallback.
    const res = await request.get(
      '/unknown-user-zzz/post/unknown-slug-zzz/opengraph-image',
      { maxRedirects: 0 },
    )
    expect(res.status()).toBe(302)
    expect(res.headers()['location'] ?? '').toContain('/og.png')
  })

  test('profile page emits Person JSON-LD with @username', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    // Create a post just to surface the author's username via the
    // returned URL — same trick as the feed test above.
    const suffix = String(Date.now())
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: {
        type: 'post',
        title: `E2E JSON-LD Profile ${suffix}`,
        summary: 'A sufficiently long summary that passes validation.',
        body_md: 'x'.repeat(60),
        tags: ['rag'],
      },
    })
    expect(createRes.status()).toBe(201)
    const { url } = (await createRes.json()) as { url: string }
    const username = new URL(url).pathname.split('/').filter(Boolean)[0]

    await page.goto(`/${username}`, { waitUntil: 'domcontentloaded' })

    const ld = page.locator('script[type="application/ld+json"]').first()
    await expect(ld).toHaveCount(1)
    const raw = (await ld.textContent()) ?? ''
    const parsed = JSON.parse(raw) as {
      '@type': string
      alternateName: string
    }
    expect(parsed['@type']).toBe('Person')
    expect(parsed.alternateName).toBe(`@${username}`)
  })
})
