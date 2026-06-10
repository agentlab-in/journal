import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: next/cache — revalidateTag
// ---------------------------------------------------------------------------
const revalidateTagMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
}))

// ---------------------------------------------------------------------------
// Mocks (same shape used by tests/unit/api/admin/unban.test.ts)
// ---------------------------------------------------------------------------

const sessionState: { value: { user: { id: string } } | null } = { value: null }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
}))

let adminGateResult: Response | null = null

vi.mock('@/lib/admin', () => ({
  requireAdminApi: vi.fn(async () => adminGateResult),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_ID = 'aabbccdd-1234-4000-8001-000000000001'
const AUTHOR_ID = 'aabbccdd-1234-4000-8001-000000000002'
const POST_ID = 'aabbccdd-1234-4000-8001-000000000010'

const MOD_DELETED_POST = {
  id: POST_ID,
  author_id: AUTHOR_ID,
  slug: 'hello-world',
  deleted_at: '2026-05-01T00:00:00.000Z',
  deletion_reason: 'moderation' as const,
}
const AUTHOR_DELETED_POST = { ...MOD_DELETED_POST, deletion_reason: 'author' as const }
const LIVE_POST = { ...MOD_DELETED_POST, deleted_at: null, deletion_reason: null }

// ---------------------------------------------------------------------------
// Fake supabase client
// ---------------------------------------------------------------------------

function makeFakeClient(opts: {
  postRow?: unknown
  updateError?: { message: string } | null
  modActionsError?: { message: string } | null
} = {}) {
  const { postRow = MOD_DELETED_POST, updateError = null, modActionsError = null } = opts

  const modActionsInsertFn = vi.fn(async () => ({ error: modActionsError }))
  const updateEqFn = vi.fn(async () => ({ error: updateError }))
  const updateFn = vi.fn(() => ({ eq: updateEqFn }))

  return {
    from: vi.fn((table: string) => {
      if (table === 'posts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: postRow,
            error: postRow ? null : { message: 'not found' },
          })),
          update: updateFn,
        }
      }
      if (table === 'mod_actions') {
        return { insert: modActionsInsertFn }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      }
    }),
    modActionsInsertFn,
    updateFn,
  }
}

function makeRequest(body: unknown = {}) {
  return new Request('http://test/api/posts/x/restore', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: JSON.stringify(body),
  })
}

function params() {
  return { params: Promise.resolve({ id: POST_ID }) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/posts/[id]/restore — authorization', () => {
  it('returns 401 when no session', async () => {
    sessionState.value = null
    adminGateResult = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    currentFakeClient = makeFakeClient()

    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest(), params())
    expect(res.status).toBe(401)
  })

  it('returns 404 when authed non-admin', async () => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    adminGateResult = new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    currentFakeClient = makeFakeClient()

    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest(), params())
    expect(res.status).toBe(404)
  })
})

describe('POST /api/posts/[id]/restore — state checks', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
  })

  it('returns 404 when post does not exist', async () => {
    currentFakeClient = makeFakeClient({ postRow: null })
    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest(), params())
    expect(res.status).toBe(404)
  })

  it('returns 400 not_deleted when post is currently live', async () => {
    currentFakeClient = makeFakeClient({ postRow: LIVE_POST })
    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest(), params())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('not_deleted')
  })

  it('returns 400 not_restorable when the deletion was by the author', async () => {
    currentFakeClient = makeFakeClient({ postRow: AUTHOR_DELETED_POST })
    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest(), params())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('not_restorable')
    expect(body.detail).toBe('author')
  })
})

describe('POST /api/posts/[id]/restore — happy path', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
  })

  it('clears deleted_at + deletion_reason and writes a restore_post mod_action', async () => {
    const client = makeFakeClient()
    currentFakeClient = client

    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest(), params())
    expect(res.status).toBe(200)

    // posts.update called with both fields cleared
    expect(client.updateFn).toHaveBeenCalledWith({ deleted_at: null, deletion_reason: null })

    // mod_actions row recorded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modCall = (client.modActionsInsertFn.mock.calls as any[][])[0]![0]
    expect(modCall.action).toBe('restore_post')
    expect(modCall.target_type).toBe('post')
    expect(modCall.target_id).toBe(POST_ID)
    expect(modCall.mod_user_id).toBe(ADMIN_ID)
    expect(modCall.metadata).toMatchObject({ slug: 'hello-world', author_id: AUTHOR_ID })
  })

  it('passes through an optional moderator reason (capped at 1000 chars)', async () => {
    const client = makeFakeClient()
    currentFakeClient = client

    const longReason = 'x'.repeat(1500)
    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest({ reason: longReason }), params())
    expect(res.status).toBe(200)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modCall = (client.modActionsInsertFn.mock.calls as any[][])[0]![0]
    expect(modCall.reason).toBe('x'.repeat(1000))
  })
})

// ---------------------------------------------------------------------------
// Tests — revalidateTag cache invalidation (Phase B discovery-cache contract)
// ---------------------------------------------------------------------------
describe('POST /api/posts/[id]/restore — revalidateTag cache invalidation', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    revalidateTagMock.mockReset()
  })

  it('calls revalidateTag("posts", { expire: 0 }) after successful restore', async () => {
    currentFakeClient = makeFakeClient()
    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest(), params())
    expect(res.status).toBe(200)

    expect(revalidateTagMock).toHaveBeenCalledWith('posts', { expire: 0 })
  })

  it('does NOT call revalidateTag when restore fails with 401 (no session)', async () => {
    sessionState.value = null
    adminGateResult = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    currentFakeClient = makeFakeClient()

    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest(), params())
    expect(res.status).toBe(401)

    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('does NOT call revalidateTag when restore fails with 404 (non-admin)', async () => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    adminGateResult = new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    currentFakeClient = makeFakeClient()

    const { POST } = await import('@/app/api/posts/[id]/restore/route')
    const res = await POST(makeRequest(), params())
    expect(res.status).toBe(404)

    expect(revalidateTagMock).not.toHaveBeenCalled()
  })
})
