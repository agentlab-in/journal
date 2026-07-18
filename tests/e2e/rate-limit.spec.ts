/**
 * Phase 14 hardening — rate-limit + origin + health E2E coverage.
 *
 * Two scenarios:
 *
 *   B. POST /api/posts with a non-allowlisted `Origin` is rejected with
 *      403 `{ error: 'forbidden_origin' }`. Auth runs BEFORE the origin
 *      check in the route (`getSession` → 401), so we must be authed for
 *      the origin guard to ever fire — hence the e2e-auth header.
 *
 *   C. GET /api/health returns the documented contract shape. In the
 *      Playwright dev env the Supabase URL is `.invalid` so the DB ping
 *      fails and the endpoint returns `{ ok: false, db: 'down' }` with a
 *      503. With real secrets it returns `{ ok: true, db: 'ok' }` / 200.
 *      The test accepts either, asserting the shape.
 *
 * Auth strategy: `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`
 * when `E2E_TEST_AUTH_USER_ID` is set. Tests gate on `HAS_E2E_AUTH` so the
 * suite cleanly skips in CI when no E2E env is wired.
 *
 * The former scenario A (spam-clicking like trips the `engagement` rate
 * bucket) was removed with the likes feature (issue #85).
 */
import { test, expect } from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const SKIP_REASON = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Phase 14 hardening — rate-limit + origin + health', () => {
  // -------------------------------------------------------------------------
  // B. Cross-origin POST to /api/posts → 403 forbidden_origin.
  //
  // Route order is auth → guardMutatingRequest. We send the e2e auth
  // header so we clear auth, then a non-allowlisted Origin so the
  // guard rejects. Body is intentionally garbage — the guard runs
  // BEFORE Zod parsing.
  // -------------------------------------------------------------------------
  test('cross-origin POST to /api/posts rejected with 403 forbidden_origin', async ({
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const res = await request.post('/api/posts', {
      headers: {
        ...HEADER_E2E_AUTH,
        Origin: 'https://evil.example',
      },
      data: { anything: true },
    })

    expect(res.status()).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('forbidden_origin')
  })

  // -------------------------------------------------------------------------
  // C. GET /api/health returns the contract shape.
  //
  // In CI / local dev under Playwright the Supabase URL is .invalid
  // (playwright.config.ts) so the DB ping errors and the endpoint
  // returns 503 / { ok: false, db: 'down' }. With real secrets it's
  // 200 / { ok: true, db: 'ok' }. Either is acceptable — assert the
  // shape so the contract holds regardless of DB state.
  // -------------------------------------------------------------------------
  test('/api/health returns the documented contract shape', async ({
    request,
  }) => {
    const res = await request.get('/api/health')
    expect([200, 503]).toContain(res.status())

    const body = (await res.json()) as { ok: unknown; db: unknown }
    expect(body).toHaveProperty('ok')
    expect(body).toHaveProperty('db')
    expect(typeof body.ok).toBe('boolean')
    expect(['ok', 'down']).toContain(body.db)
    // Sanity: ok ↔ db === 'ok'.
    if (body.db === 'ok') {
      expect(body.ok).toBe(true)
      expect(res.status()).toBe(200)
    } else {
      expect(body.ok).toBe(false)
      expect(res.status()).toBe(503)
    }
  })
})
