/**
 * Phase 4 publish API — E2E tests
 *
 * Auth strategy: same E2E shim as editor.spec.ts.
 *   - header `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`.
 *   - env `E2E_TEST_AUTH_USER_ID` sets the user ID the bypass returns.
 *
 * DB dependency: tests 4–6 hit the database (Supabase service role key
 * required). They are skipped when E2E_TEST_AUTH_USER_ID is not set.
 * Tests 1–3 (unauth) rely only on the session middleware — no DB — so
 * they run everywhere.
 */
import { test, expect } from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const SKIP_REASON = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'

// A minimal valid POST body.
function validPostBody(suffix: string) {
  return {
    type: 'post',
    title: `E2E Test Post ${suffix}`,
    summary: 'A summary long enough to pass validation.',
    body_md: 'x'.repeat(60),
    tags: ['rag'],
  }
}

test.describe('Phase 4 publish API', () => {
  // --------------------------------------------------------------------------
  // 1. Unauth POST /api/posts → 401
  // --------------------------------------------------------------------------
  test('unauth POST /api/posts returns 401', async ({ request }) => {
    const res = await request.post('/api/posts', {
      data: validPostBody('unauth'),
    })
    expect(res.status()).toBe(401)
  })

  // --------------------------------------------------------------------------
  // 2. Unauth PATCH /api/posts/<random-uuid> → 401
  // --------------------------------------------------------------------------
  test('unauth PATCH /api/posts/:id returns 401', async ({ request }) => {
    const res = await request.patch(
      '/api/posts/00000000-0000-0000-0000-000000000000',
      { data: {} },
    )
    expect(res.status()).toBe(401)
  })

  // --------------------------------------------------------------------------
  // 3. Unauth DELETE /api/posts/<random-uuid> → 401
  // --------------------------------------------------------------------------
  test('unauth DELETE /api/posts/:id returns 401', async ({ request }) => {
    const res = await request.delete(
      '/api/posts/00000000-0000-0000-0000-000000000000',
    )
    expect(res.status()).toBe(401)
  })

  // --------------------------------------------------------------------------
  // 4. Authed POST with invalid body → 400 with issues array
  // --------------------------------------------------------------------------
  test('authed POST with invalid body returns 400 with issues', async ({
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const res = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: {
        // missing required fields — will fail Zod schema
        type: 'post',
        title: '',
        summary: '',
        body_md: '',
        tags: [],
      },
    })
    expect(res.status()).toBe(400)
    const body = await res.json() as { error: string; issues?: unknown[] }
    expect(body.error).toBe('invalid_body')
    expect(Array.isArray(body.issues)).toBe(true)
  })

  // --------------------------------------------------------------------------
  // 5. Authed POST with valid minimal body → 201 with { id, slug, url }
  // --------------------------------------------------------------------------
  test('authed POST with valid body returns 201 with id/slug/url', async ({
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const res = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: validPostBody(suffix),
    })
    expect(res.status()).toBe(201)
    const body = await res.json() as { id?: string; slug?: string; url?: string }
    expect(typeof body.id).toBe('string')
    expect(typeof body.slug).toBe('string')
    expect(typeof body.url).toBe('string')
    // url follows the /<username>/<type>/<slug> pattern
    expect(body.url).toMatch(/^\/[^/]+\/post\/[^/]+$/)
  })

  // --------------------------------------------------------------------------
  // 6. Authed PATCH on a post just created → 200; subsequent DELETE → 200
  // --------------------------------------------------------------------------
  test('authed PATCH own post → 200; DELETE own post → 200', async ({
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    // Create the post first
    const createRes = await request.post('/api/posts', {
      headers: HEADER_E2E_AUTH,
      data: validPostBody(`patch-delete-${Date.now()}`),
    })
    expect(createRes.status()).toBe(201)
    const { id } = await createRes.json() as { id: string }

    // PATCH it
    const patchRes = await request.patch(`/api/posts/${id}`, {
      headers: HEADER_E2E_AUTH,
      data: {
        title: 'Updated E2E Title Here',
        summary: 'An updated summary that is long enough.',
        body_md: 'y'.repeat(60),
        tags: ['rag'],
      },
    })
    expect(patchRes.status()).toBe(200)
    const patchBody = await patchRes.json() as { id?: string; url?: string }
    expect(patchBody.id).toBe(id)

    // DELETE it
    const deleteRes = await request.delete(`/api/posts/${id}`, {
      headers: HEADER_E2E_AUTH,
    })
    expect(deleteRes.status()).toBe(200)
    const deleteBody = await deleteRes.json() as { ok?: boolean }
    expect(deleteBody.ok).toBe(true)
  })
})
