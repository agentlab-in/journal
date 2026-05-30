import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }
const isAdminState = { value: false }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
  isAdmin: vi.fn(() => isAdminState.value),
  resolveIsAdmin: vi.fn(async () => isAdminState.value),
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/admin
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

// ---------------------------------------------------------------------------
// Captured operations
// ---------------------------------------------------------------------------
interface CapturedOp { table: string; op: string; payload: unknown }
const capturedOps: CapturedOp[] = []

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const COMMENT_ID = '33333333-3333-4333-8333-333333333333'
const AUTHOR_ID = 'author-123'

interface CommentRow {
  id: string
  author_id: string
  body: string
  created_at: string
  deleted_at: string | null
}

const LIVE_COMMENT: CommentRow = {
  id: COMMENT_ID,
  author_id: AUTHOR_ID,
  body: 'live body',
  created_at: '2026-05-30T00:00:00.000Z',
  deleted_at: null,
}

const DELETED_COMMENT: CommentRow = {
  ...LIVE_COMMENT,
  deleted_at: '2026-01-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function commentsHandler(commentRow: CommentRow | null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve(
            commentRow
              ? { data: commentRow, error: null }
              : { data: null, error: { message: 'not found' } },
          ),
        ),
      })),
    })),
    update: vi.fn((payload: unknown) => ({
      eq: vi.fn((_field: string, _val: unknown) => {
        capturedOps.push({ table: 'comments', op: 'update', payload })
        return Promise.resolve({ data: null, error: null })
      }),
    })),
  }
}

function modActionsHandler(opts: { insertError?: { message: string } | null } = {}) {
  const { insertError = null } = opts
  return {
    insert: vi.fn((payload: unknown) => {
      capturedOps.push({ table: 'mod_actions', op: 'insert', payload })
      return Promise.resolve({ data: null, error: insertError })
    }),
  }
}

function makeDeleteClient(opts: {
  commentRow?: CommentRow | null
  modActionsInsertError?: { message: string } | null
} = {}) {
  const { commentRow = LIVE_COMMENT, modActionsInsertError = null } = opts
  return {
    from: vi.fn((table: string) => {
      if (table === 'comments') return commentsHandler(commentRow)
      if (table === 'mod_actions') return modActionsHandler({ insertError: modActionsInsertError })
      return {}
    }),
  }
}

function makeRequest(commentId: string, body?: string) {
  return new Request(`http://test/api/comments/${commentId}`, {
    method: 'DELETE',
    headers: { Origin: 'http://localhost:3010' },
    body: body ?? undefined,
  })
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DELETE /api/comments/[id] — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient()
  })

  it('returns 401 when no session', async () => {
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })
})

describe('DELETE /api/comments/[id] — 404 comment missing / already deleted', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    isAdminState.value = false
    capturedOps.length = 0
  })

  it('returns 404 when comment does not exist', async () => {
    currentFakeClient = makeDeleteClient({ commentRow: null })
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('returns 404 when comment is already soft-deleted', async () => {
    currentFakeClient = makeDeleteClient({ commentRow: DELETED_COMMENT })
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('DELETE /api/comments/[id] — 403 neither author nor admin', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'random-user' } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient()
  })

  it('returns 403 when requestor is not author and not admin', async () => {
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })
})

describe("DELETE /api/comments/[id] — author delete sets deletion_reason='author'", () => {
  beforeEach(() => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient()
  })

  it("returns 200 with deletion_reason='author' and does NOT null the body", async () => {
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, deletion_reason: 'author' })

    const updateOp = capturedOps.find(
      (op) => op.table === 'comments' && op.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    expect(payload.deletion_reason).toBe('author')
    expect(typeof payload.deleted_at).toBe('string')
    // body must be retained for audit (placeholder is render-layer concern)
    expect(payload).not.toHaveProperty('body')
  })

  it('does NOT insert a mod_actions row on author delete', async () => {
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))

    const modOp = capturedOps.find((op) => op.table === 'mod_actions')
    expect(modOp).toBeUndefined()
  })
})

describe("DELETE /api/comments/[id] — admin (non-author) delete sets deletion_reason='moderation'", () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'admin-user' } }
    isAdminState.value = true
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient()
  })

  it("returns 200 with deletion_reason='moderation' when admin (non-author) deletes", async () => {
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, deletion_reason: 'moderation' })

    const updateOp = capturedOps.find(
      (op) => op.table === 'comments' && op.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    expect(payload.deletion_reason).toBe('moderation')
  })

  it('inserts a mod_actions row with correct fields on admin delete', async () => {
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(
      makeRequest(COMMENT_ID, JSON.stringify({ reason: 'harassment' })) as never,
      makeContext(COMMENT_ID),
    )
    expect(res.status).toBe(200)

    const modOp = capturedOps.find((op) => op.table === 'mod_actions' && op.op === 'insert')
    expect(modOp).toBeDefined()
    const modPayload = modOp!.payload as Record<string, unknown>
    expect(modPayload.mod_user_id).toBe('admin-user')
    expect(modPayload.action).toBe('delete_comment')
    expect(modPayload.target_type).toBe('comment')
    expect(modPayload.target_id).toBe(COMMENT_ID)
    expect(modPayload.reason).toBe('harassment')
    expect(modPayload.metadata).toEqual({ author_id: AUTHOR_ID })
  })

  it('inserts mod_actions row with reason=null when no body provided', async () => {
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))
    expect(res.status).toBe(200)

    const modOp = capturedOps.find((op) => op.table === 'mod_actions' && op.op === 'insert')
    expect(modOp).toBeDefined()
    const modPayload = modOp!.payload as Record<string, unknown>
    expect(modPayload.reason).toBeNull()
  })

  it('returns 200 even when mod_actions insert fails (soft failure)', async () => {
    currentFakeClient = makeDeleteClient({
      modActionsInsertError: { message: 'insert error' },
    })
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))
    // Deletion succeeded; audit insert failed but we still return 200
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

describe("DELETE /api/comments/[id] — author who is also admin gets 'author' (precedence)", () => {
  beforeEach(() => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    isAdminState.value = true
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient()
  })

  it("sets deletion_reason='author' when author is also admin", async () => {
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    const res = await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deletion_reason).toBe('author')

    const updateOp = capturedOps.find(
      (op) => op.table === 'comments' && op.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    expect(payload.deletion_reason).toBe('author')
  })

  it('does NOT insert mod_actions when author-admin deletes their own comment', async () => {
    const { DELETE } = await import('@/app/api/comments/[id]/route')
    await DELETE(makeRequest(COMMENT_ID) as never, makeContext(COMMENT_ID))

    const modOp = capturedOps.find((op) => op.table === 'mod_actions')
    expect(modOp).toBeUndefined()
  })
})
