import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/server
// ---------------------------------------------------------------------------
// Note: the health route was switched to the anon server client (M2 — security
// audit 2026-06-01) so that an unauthenticated probe doesn't load the
// service-role key. The mock surface is the same — only the factory name
// changed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/server', () => ({
  createAnonServerSupabaseClient: vi.fn(() => currentFakeClient),
}))

function makeClient(opts: { error?: { message: string } | null; throws?: boolean } = {}) {
  const { error = null, throws = false } = opts
  if (throws) {
    return {
      from: () => {
        throw new Error('boom')
      },
    }
  }
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve({ data: [], error })),
      })),
    })),
  }
}

describe('GET /api/health', () => {
  beforeEach(() => {
    currentFakeClient = makeClient()
  })

  it('returns 200 { ok: true, db: ok } when DB query succeeds', async () => {
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, db: 'ok' })
  })

  it('returns 503 { ok: false, db: down } when DB returns an error', async () => {
    currentFakeClient = makeClient({ error: { message: 'connection refused' } })
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, db: 'down' })
  })

  it('returns 503 when the supabase client throws synchronously', async () => {
    currentFakeClient = makeClient({ throws: true })
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, db: 'down' })
  })

  it('sets Content-Type: application/json', async () => {
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
