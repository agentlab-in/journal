import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/admin
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

// ---------------------------------------------------------------------------
// Captured RPC calls for assertion
// ---------------------------------------------------------------------------
interface CapturedRpc { fnName: string; args: Record<string, unknown> }
const capturedRpcs: CapturedRpc[] = []

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

function makeViewClient(opts: { rpcError?: { message: string } | null } = {}) {
  const { rpcError = null } = opts
  return {
    rpc: vi.fn((fnName: string, args: Record<string, unknown>) => {
      capturedRpcs.push({ fnName, args })
      return Promise.resolve({ data: null, error: rpcError })
    }),
  }
}

// ---------------------------------------------------------------------------
// Request / context factory
// ---------------------------------------------------------------------------

function makeRequest(postId: string) {
  return new Request(`http://test/api/posts/${postId}/view`, {
    method: 'POST',
  })
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/posts/[id]/view — happy path', () => {
  beforeEach(() => {
    capturedRpcs.length = 0
    currentFakeClient = makeViewClient()
  })

  it('returns 204 and calls increment_post_view_count with the post id', async () => {
    const { POST } = await import('@/app/api/posts/[id]/view/route')
    const res = await POST(makeRequest('00000000-0000-0000-0000-000000000001') as never, makeContext('00000000-0000-0000-0000-000000000001'))

    expect(res.status).toBe(204)
    // Body must be empty for a 204
    const text = await res.text()
    expect(text).toBe('')

    expect(capturedRpcs).toHaveLength(1)
    expect(capturedRpcs[0].fnName).toBe('increment_post_view_count')
    expect(capturedRpcs[0].args).toEqual({ p_id: '00000000-0000-0000-0000-000000000001' })
  })
})

describe('POST /api/posts/[id]/view — RPC error is swallowed (fire-and-forget)', () => {
  beforeEach(() => {
    capturedRpcs.length = 0
    currentFakeClient = makeViewClient({ rpcError: { message: 'relation "posts" does not exist' } })
  })

  it('still returns 204 when the RPC returns an error', async () => {
    const { POST } = await import('@/app/api/posts/[id]/view/route')
    const res = await POST(makeRequest('00000000-0000-0000-0000-000000000002') as never, makeContext('00000000-0000-0000-0000-000000000002'))

    expect(res.status).toBe(204)
    // The RPC was still attempted
    expect(capturedRpcs).toHaveLength(1)
    expect(capturedRpcs[0].fnName).toBe('increment_post_view_count')
  })
})

describe('POST /api/posts/[id]/view — non-uuid id (no validation)', () => {
  beforeEach(() => {
    capturedRpcs.length = 0
    currentFakeClient = makeViewClient()
  })

  it('returns 204 for an invalid (non-uuid) id — DB call may just no-op', async () => {
    const { POST } = await import('@/app/api/posts/[id]/view/route')
    const res = await POST(makeRequest('not-a-uuid') as never, makeContext('not-a-uuid'))

    expect(res.status).toBe(204)
    // We still forward the id to the DB unchanged; the DB will silently no-op
    expect(capturedRpcs).toHaveLength(1)
    expect(capturedRpcs[0].args).toEqual({ p_id: 'not-a-uuid' })
  })
})
