import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mocks mirror tests/unit/api/posts/restore.test.ts.

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

const ADMIN_ID = 'aabbccdd-1234-4000-8001-000000000001'
const AUTHOR_ID = 'aabbccdd-1234-4000-8001-000000000002'
const COMMENT_ID = 'aabbccdd-1234-4000-8001-000000000050'

const MOD_DELETED_COMMENT = {
  id: COMMENT_ID,
  author_id: AUTHOR_ID,
  deleted_at: '2026-05-01T00:00:00.000Z',
  deletion_reason: 'moderation' as const,
}
const AUTHOR_DELETED_COMMENT = { ...MOD_DELETED_COMMENT, deletion_reason: 'author' as const }
const LIVE_COMMENT = { ...MOD_DELETED_COMMENT, deleted_at: null, deletion_reason: null }

function makeFakeClient(opts: {
  commentRow?: unknown
  updateError?: { message: string } | null
  modActionsError?: { message: string } | null
} = {}) {
  const { commentRow = MOD_DELETED_COMMENT, updateError = null, modActionsError = null } = opts

  const modActionsInsertFn = vi.fn(async () => ({ error: modActionsError }))
  const updateEqFn = vi.fn(async () => ({ error: updateError }))
  const updateFn = vi.fn(() => ({ eq: updateEqFn }))

  return {
    from: vi.fn((table: string) => {
      if (table === 'comments') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: commentRow,
            error: commentRow ? null : { message: 'not found' },
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
  return new Request('http://test/api/comments/x/restore', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: JSON.stringify(body),
  })
}

function params() {
  return { params: Promise.resolve({ id: COMMENT_ID }) }
}

describe('POST /api/comments/[id]/restore', () => {
  it('returns 401 when no session', async () => {
    sessionState.value = null
    adminGateResult = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    currentFakeClient = makeFakeClient()
    const { POST } = await import('@/app/api/comments/[id]/restore/route')
    expect((await POST(makeRequest(), params())).status).toBe(401)
  })

  it('returns 404 when authed non-admin', async () => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    adminGateResult = new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    currentFakeClient = makeFakeClient()
    const { POST } = await import('@/app/api/comments/[id]/restore/route')
    expect((await POST(makeRequest(), params())).status).toBe(404)
  })

  describe('admin', () => {
    beforeEach(() => {
      sessionState.value = { user: { id: ADMIN_ID } }
      adminGateResult = null
    })

    it('returns 404 when comment does not exist', async () => {
      currentFakeClient = makeFakeClient({ commentRow: null })
      const { POST } = await import('@/app/api/comments/[id]/restore/route')
      expect((await POST(makeRequest(), params())).status).toBe(404)
    })

    it('returns 400 not_deleted on a live comment', async () => {
      currentFakeClient = makeFakeClient({ commentRow: LIVE_COMMENT })
      const { POST } = await import('@/app/api/comments/[id]/restore/route')
      const res = await POST(makeRequest(), params())
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('not_deleted')
    })

    it('returns 400 not_restorable when author-deleted', async () => {
      currentFakeClient = makeFakeClient({ commentRow: AUTHOR_DELETED_COMMENT })
      const { POST } = await import('@/app/api/comments/[id]/restore/route')
      const res = await POST(makeRequest(), params())
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('not_restorable')
      expect(body.detail).toBe('author')
    })

    it('clears state and writes restore_comment audit row on success', async () => {
      const client = makeFakeClient()
      currentFakeClient = client
      const { POST } = await import('@/app/api/comments/[id]/restore/route')
      const res = await POST(makeRequest(), params())
      expect(res.status).toBe(200)

      expect(client.updateFn).toHaveBeenCalledWith({ deleted_at: null, deletion_reason: null })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modCall = (client.modActionsInsertFn.mock.calls as any[][])[0]![0]
      expect(modCall.action).toBe('restore_comment')
      expect(modCall.target_type).toBe('comment')
      expect(modCall.target_id).toBe(COMMENT_ID)
      expect(modCall.metadata).toMatchObject({ author_id: AUTHOR_ID })
    })
  })
})
