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
const RECENT_CREATED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
const OLD_CREATED_AT = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() // 48 hours ago

interface CommentRow {
  id: string
  author_id: string
  body: string
  created_at: string
  deleted_at: string | null
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

function makePatchClient(opts: { commentRow?: CommentRow | null } = {}) {
  const {
    commentRow = {
      id: COMMENT_ID,
      author_id: AUTHOR_ID,
      body: 'old body',
      created_at: RECENT_CREATED_AT,
      deleted_at: null,
    },
  } = opts

  return {
    from: vi.fn((table: string) => {
      if (table === 'comments') return commentsHandler(commentRow)
      return {}
    }),
  }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
function makeRequest(commentId: string, body: unknown) {
  return new Request(`http://test/api/comments/${commentId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/comments/[id] — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makePatchClient()
  })

  it('returns 401 when no session', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    const res = await PATCH(makeRequest(COMMENT_ID, { body: 'x' }) as never, makeContext(COMMENT_ID))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })
})

describe('PATCH /api/comments/[id] — 404 comment missing', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makePatchClient({ commentRow: null })
  })

  it('returns 404 when comment does not exist', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    const res = await PATCH(
      makeRequest(COMMENT_ID, { body: 'updated' }) as never,
      makeContext(COMMENT_ID),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('PATCH /api/comments/[id] — 404 already deleted', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makePatchClient({
      commentRow: {
        id: COMMENT_ID,
        author_id: AUTHOR_ID,
        body: 'old',
        created_at: RECENT_CREATED_AT,
        deleted_at: '2026-01-01T00:00:00Z',
      },
    })
  })

  it('returns 404 when comment is already soft-deleted', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    const res = await PATCH(
      makeRequest(COMMENT_ID, { body: 'updated' }) as never,
      makeContext(COMMENT_ID),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('PATCH /api/comments/[id] — 403 not author (admin does not get edit)', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'other-user' } }
    isAdminState.value = true // admin should NOT bypass author-only edit gate
    capturedOps.length = 0
    currentFakeClient = makePatchClient()
  })

  it('returns 403 when requestor is not the author, even if admin', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    const res = await PATCH(
      makeRequest(COMMENT_ID, { body: 'updated' }) as never,
      makeContext(COMMENT_ID),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })
})

describe('PATCH /api/comments/[id] — 403 edit_window_expired', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makePatchClient({
      commentRow: {
        id: COMMENT_ID,
        author_id: AUTHOR_ID,
        body: 'old',
        created_at: OLD_CREATED_AT,
        deleted_at: null,
      },
    })
  })

  it('returns 403 edit_window_expired when comment is older than 24h', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    const res = await PATCH(
      makeRequest(COMMENT_ID, { body: 'updated' }) as never,
      makeContext(COMMENT_ID),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('edit_window_expired')
  })
})

describe('PATCH /api/comments/[id] — 400 invalid_body', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makePatchClient()
  })

  it('returns 400 invalid_body when body field is missing', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    const res = await PATCH(
      makeRequest(COMMENT_ID, {}) as never,
      makeContext(COMMENT_ID),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })
})

describe('PATCH /api/comments/[id] — 400 empty_body after sanitize', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makePatchClient()
  })

  it('returns 400 empty_body when sanitized body is empty', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    const res = await PATCH(
      makeRequest(COMMENT_ID, { body: '<script></script>' }) as never,
      makeContext(COMMENT_ID),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('empty_body')
  })
})

describe('PATCH /api/comments/[id] — happy path (author within 24h)', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: AUTHOR_ID } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makePatchClient()
  })

  it('returns 200 with { id, body, edited_at } on valid update', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    const res = await PATCH(
      makeRequest(COMMENT_ID, { body: 'updated body' }) as never,
      makeContext(COMMENT_ID),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(COMMENT_ID)
    expect(body.body).toBe('updated body')
    expect(typeof body.edited_at).toBe('string')
    expect(new Date(body.edited_at).getTime()).toBeGreaterThan(0)
  })

  it('update payload contains only body + edited_at (not post_id/parent_comment_id)', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    await PATCH(
      makeRequest(COMMENT_ID, { body: 'updated body' }) as never,
      makeContext(COMMENT_ID),
    )

    const updateOp = capturedOps.find(
      (op) => op.table === 'comments' && op.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    expect(payload.body).toBe('updated body')
    expect(typeof payload.edited_at).toBe('string')
    // Immutable fields must not be touched
    expect(payload).not.toHaveProperty('post_id')
    expect(payload).not.toHaveProperty('parent_comment_id')
  })

  it('strips HTML tags before update', async () => {
    const { PATCH } = await import('@/app/api/comments/[id]/route')
    const res = await PATCH(
      makeRequest(COMMENT_ID, { body: '<b>clean</b> <i>text</i>' }) as never,
      makeContext(COMMENT_ID),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.body).toBe('clean text')

    const updateOp = capturedOps.find(
      (op) => op.table === 'comments' && op.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    expect(payload.body).toBe('clean text')
  })
})
