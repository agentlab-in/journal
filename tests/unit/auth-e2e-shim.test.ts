/**
 * Unit tests for the hardened E2E auth shim in lib/auth.ts (M/L audit L12).
 *
 * The shim returns a synthetic session ONLY when ALL of the following hold:
 *   - ALLOW_E2E_AUTH === '1'           (explicit opt-in flag, new in L12)
 *   - NODE_ENV !== 'production'
 *   - VERCEL_ENV !== 'production'      (new in L12)
 *   - E2E_TEST_AUTH_USER_ID is set
 *   - Request carries `x-e2e-auth: 1`
 *
 * Tests verify the matrix: each missing/wrong condition must collapse
 * the shim to the real getServerSession path (which we stub to null).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// next/headers is imported dynamically inside getSession; vi.mock hoists
// before the module under test loads either way.
const headersGetMock = vi.fn<(name: string) => string | null>()
vi.mock('next/headers', () => ({
  headers: async () => ({ get: headersGetMock }),
}))

// getServerSession is called when the shim does NOT short-circuit; force
// it to null so any unwanted fall-through is visible as a null result.
// lib/auth.ts imports from 'next-auth/next', not the package root.
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(async () => null),
}))

// Per-request ban-check Supabase factory. getSession() only runs this
// branch when getServerSession returns a real session, so for these
// shim-focused tests we just keep it from throwing.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  }),
}))

import { getSession } from '@/lib/auth'

type EnvSnapshot = {
  ALLOW_E2E_AUTH: string | undefined
  E2E_TEST_AUTH_USER_ID: string | undefined
  NODE_ENV: string | undefined
  VERCEL_ENV: string | undefined
}

function snapshot(): EnvSnapshot {
  return {
    ALLOW_E2E_AUTH: process.env.ALLOW_E2E_AUTH,
    E2E_TEST_AUTH_USER_ID: process.env.E2E_TEST_AUTH_USER_ID,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  }
}

function restore(snap: EnvSnapshot) {
  // NODE_ENV is typed as readonly on `process.env` in @types/node; cast
  // through a plain index signature so tests can mutate it freely.
  const env = process.env as Record<string, string | undefined>
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
}

const E2E_USER_ID = '00000000-0000-4000-8000-000000000099'

// process.env.NODE_ENV is typed readonly; use a writable index signature
// alias to mutate it in tests without per-line casts.
const env = process.env as Record<string, string | undefined>

function setAllGatesGreen() {
  env.ALLOW_E2E_AUTH = '1'
  env.E2E_TEST_AUTH_USER_ID = E2E_USER_ID
  env.NODE_ENV = 'test'
  delete env.VERCEL_ENV
  headersGetMock.mockReturnValue('1')
}

describe('getSession() E2E shim — hardened gates (L12)', () => {
  let snap: EnvSnapshot

  beforeEach(() => {
    snap = snapshot()
    headersGetMock.mockReset()
  })

  afterEach(() => {
    restore(snap)
  })

  it('returns a synthetic session when ALL gates pass + header present', async () => {
    setAllGatesGreen()
    const out = await getSession()
    expect(out).not.toBeNull()
    expect(out?.user?.id).toBe(E2E_USER_ID)
    expect(out?.user?.email).toBe('e2e-user@example.test')
  })

  it('refuses (returns null) when ALLOW_E2E_AUTH is unset', async () => {
    setAllGatesGreen()
    delete process.env.ALLOW_E2E_AUTH
    const out = await getSession()
    expect(out).toBeNull()
  })

  it('refuses when ALLOW_E2E_AUTH is set to something other than "1"', async () => {
    setAllGatesGreen()
    process.env.ALLOW_E2E_AUTH = 'true' // truthy but not the literal "1"
    const out = await getSession()
    expect(out).toBeNull()
  })

  it('refuses when NODE_ENV === "production" even with the flag', async () => {
    setAllGatesGreen()
    env.NODE_ENV = 'production'
    const out = await getSession()
    expect(out).toBeNull()
  })

  it('refuses when VERCEL_ENV === "production" regardless of the flag (L12 belt-and-braces)', async () => {
    setAllGatesGreen()
    process.env.VERCEL_ENV = 'production'
    const out = await getSession()
    expect(out).toBeNull()
  })

  it('allows the shim when VERCEL_ENV is "preview" (Vercel preview deploys must still pass)', async () => {
    setAllGatesGreen()
    process.env.VERCEL_ENV = 'preview'
    const out = await getSession()
    expect(out?.user?.id).toBe(E2E_USER_ID)
  })

  it('refuses when E2E_TEST_AUTH_USER_ID is unset', async () => {
    setAllGatesGreen()
    delete process.env.E2E_TEST_AUTH_USER_ID
    const out = await getSession()
    expect(out).toBeNull()
  })

  it('refuses when the x-e2e-auth header is absent', async () => {
    setAllGatesGreen()
    headersGetMock.mockReturnValue(null)
    const out = await getSession()
    expect(out).toBeNull()
  })

  it('refuses when the x-e2e-auth header is present but not "1"', async () => {
    setAllGatesGreen()
    headersGetMock.mockReturnValue('0')
    const out = await getSession()
    expect(out).toBeNull()
  })
})
