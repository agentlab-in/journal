import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
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
// Captured operations for assertion
// ---------------------------------------------------------------------------
interface CapturedOp { table: string; op: string; payload: unknown }
const capturedOps: CapturedOp[] = []

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
// Valid RFC-4122 v4 UUIDs (third group starts with 4, fourth with 8/9/a/b).
const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'
const POST_ID = '33333333-3333-4333-8333-333333333333'

const OWNED_POST = {
  author_id: USER_ID,
  deleted_at: null as string | null,
}

// ---------------------------------------------------------------------------
// posts handler — supports a single .select(...).eq('id', ...).single()
// ---------------------------------------------------------------------------
function postsHandler(postRow: { author_id: string; deleted_at: string | null } | null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve(
            postRow
              ? { data: postRow, error: null }
              : { data: null, error: { message: 'not found' } },
          ),
        ),
      })),
    })),
  }
}

// ---------------------------------------------------------------------------
// pinned_posts handler — composed per-test.
//
// Supports two distinct read shapes used by the POST handler:
//   (a) existence check:  .select('post_id').eq('user_id',_).eq('post_id',_).maybeSingle()
//   (b) positions list:   .select('position').eq('user_id', _)
// And the write paths: .insert(...).select(...).single()  and  .delete().eq(...).eq(...)
// ---------------------------------------------------------------------------
interface PinnedHandlerOpts {
  existingPin?: { post_id: string } | null
  existingPositions?: number[]
  insertResult?: { data: unknown; error: unknown }
  /** For DELETE route: whether the (user_id, post_id) row exists. */
  pinRowExists?: boolean
}

function pinnedPostsHandler(opts: PinnedHandlerOpts = {}) {
  const {
    existingPin = null,
    existingPositions = [],
    insertResult = {
      data: { user_id: USER_ID, post_id: POST_ID, position: 1 },
      error: null,
    },
    pinRowExists = true,
  } = opts

  return {
    select: vi.fn((cols: string) => {
      // (a) existence-check: select('post_id') chained with two .eq() then .maybeSingle()
      if (cols.includes('post_id')) {
        // Also serves the DELETE pre-check.
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: pinRowExists && existingPin ? existingPin : null,
                  error: null,
                }),
              ),
            })),
            // DELETE route pre-check uses .eq().eq().maybeSingle() too — same chain
          })),
        }
      }
      // (b) positions list: select('position').eq('user_id', _)
      return {
        eq: vi.fn(() =>
          Promise.resolve({
            data: existingPositions.map((p) => ({ position: p })),
            error: null,
          }),
        ),
      }
    }),
    insert: vi.fn((row: unknown) => {
      capturedOps.push({ table: 'pinned_posts', op: 'insert', payload: row })
      return {
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve(insertResult)),
        })),
      }
    }),
    delete: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn((field: string, val: unknown) => {
          capturedOps.push({
            table: 'pinned_posts',
            op: 'delete',
            payload: { [field]: val },
          })
          return Promise.resolve({ data: null, error: null })
        }),
      })),
    })),
  }
}

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------
function makePostClient(opts: {
  postRow?: { author_id: string; deleted_at: string | null } | null
  pinned?: PinnedHandlerOpts
} = {}) {
  const { postRow = OWNED_POST, pinned = {} } = opts
  return {
    from: vi.fn((table: string) => {
      if (table === 'posts') return postsHandler(postRow)
      if (table === 'pinned_posts') return pinnedPostsHandler(pinned)
      return {}
    }),
  }
}

function makeDeleteClient(opts: PinnedHandlerOpts = {}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'pinned_posts') return pinnedPostsHandler(opts)
      return {}
    }),
  }
}

// ---------------------------------------------------------------------------
// Request factories
// ---------------------------------------------------------------------------
function makePostRequest(body: unknown) {
  return new Request('http://test/api/pinned-posts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(postId: string) {
  return new Request(`http://test/api/pinned-posts/${postId}`, {
    method: 'DELETE',
    headers: { Origin: 'http://localhost:3010' },
  })
}

function makeDeleteContext(postId: string) {
  return { params: Promise.resolve({ postId }) }
}

// ===========================================================================
// POST /api/pinned-posts
// ===========================================================================

describe('POST /api/pinned-posts — auth', () => {
  beforeEach(() => {
    sessionState.value = null
    capturedOps.length = 0
    currentFakeClient = makePostClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(makePostRequest({ post_id: POST_ID }) as never)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })
})

describe('POST /api/pinned-posts — invalid body', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedOps.length = 0
    currentFakeClient = makePostClient()
  })

  it('returns 400 when post_id is missing', async () => {
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(makePostRequest({}) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_body')
  })

  it('returns 400 when post_id is not a UUID', async () => {
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(makePostRequest({ post_id: 'not-a-uuid' }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_body')
  })

  it('returns 400 when body contains unknown field (strict)', async () => {
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(
      makePostRequest({ post_id: POST_ID, foo: 'bar' }) as never,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_body')
  })
})

describe('POST /api/pinned-posts — 404 post not found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedOps.length = 0
  })

  it('returns 404 when post does not exist', async () => {
    currentFakeClient = makePostClient({ postRow: null })
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(makePostRequest({ post_id: POST_ID }) as never)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('post_not_found')
  })

  it('returns 404 when post is soft-deleted', async () => {
    currentFakeClient = makePostClient({
      postRow: { author_id: USER_ID, deleted_at: '2026-01-01T00:00:00Z' },
    })
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(makePostRequest({ post_id: POST_ID }) as never)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('post_not_found')
  })
})

describe('POST /api/pinned-posts — 403 not owner', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedOps.length = 0
    currentFakeClient = makePostClient({
      postRow: { author_id: OTHER_USER_ID, deleted_at: null },
    })
  })

  it('returns 403 when post is owned by another user', async () => {
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(makePostRequest({ post_id: POST_ID }) as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('not_owner')
  })
})

describe('POST /api/pinned-posts — 409 already pinned', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedOps.length = 0
    currentFakeClient = makePostClient({
      pinned: {
        existingPin: { post_id: POST_ID },
        existingPositions: [1],
      },
    })
  })

  it('returns 409 when the user already pinned this post', async () => {
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(makePostRequest({ post_id: POST_ID }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_pinned')
  })
})

describe('POST /api/pinned-posts — 409 pin limit reached', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedOps.length = 0
    currentFakeClient = makePostClient({
      pinned: {
        existingPin: null,
        existingPositions: [1, 2, 3, 4, 5, 6],
      },
    })
  })

  it('returns 409 when the user already has 6 pins', async () => {
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(makePostRequest({ post_id: POST_ID }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('pin_limit_reached')
  })
})

describe('POST /api/pinned-posts — happy path: appends next position', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedOps.length = 0
    currentFakeClient = makePostClient({
      pinned: {
        existingPin: null,
        existingPositions: [1, 2],
        insertResult: {
          data: { user_id: USER_ID, post_id: POST_ID, position: 3 },
          error: null,
        },
      },
    })
  })

  it('inserts at position MAX(existing)+1 and returns 201', async () => {
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(makePostRequest({ post_id: POST_ID }) as never)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ user_id: USER_ID, post_id: POST_ID, position: 3 })

    const insertOp = capturedOps.find(
      (op) => op.table === 'pinned_posts' && op.op === 'insert',
    )
    expect(insertOp).toBeDefined()
    const payload = insertOp!.payload as Record<string, unknown>
    expect(payload).toEqual({
      user_id: USER_ID,
      post_id: POST_ID,
      position: 3,
    })
  })
})

describe('POST /api/pinned-posts — happy path: explicit position', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedOps.length = 0
    currentFakeClient = makePostClient({
      pinned: {
        existingPin: null,
        existingPositions: [1],
        insertResult: {
          data: { user_id: USER_ID, post_id: POST_ID, position: 5 },
          error: null,
        },
      },
    })
  })

  it('respects explicit position when provided', async () => {
    const { POST } = await import('@/app/api/pinned-posts/route')
    const res = await POST(
      makePostRequest({ post_id: POST_ID, position: 5 }) as never,
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.position).toBe(5)

    const insertOp = capturedOps.find(
      (op) => op.table === 'pinned_posts' && op.op === 'insert',
    )
    expect(insertOp).toBeDefined()
    const payload = insertOp!.payload as Record<string, unknown>
    expect(payload.position).toBe(5)
  })
})

// ===========================================================================
// DELETE /api/pinned-posts/[postId]
// ===========================================================================

describe('DELETE /api/pinned-posts/[postId] — auth', () => {
  beforeEach(() => {
    sessionState.value = null
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient()
  })

  it('returns 401 when no session', async () => {
    const { DELETE } = await import('@/app/api/pinned-posts/[postId]/route')
    const res = await DELETE(
      makeDeleteRequest(POST_ID) as never,
      makeDeleteContext(POST_ID),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })
})

describe('DELETE /api/pinned-posts/[postId] — 404 pin not found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient({ pinRowExists: false })
  })

  it('returns 404 when the (user_id, post_id) row does not exist', async () => {
    const { DELETE } = await import('@/app/api/pinned-posts/[postId]/route')
    const res = await DELETE(
      makeDeleteRequest(POST_ID) as never,
      makeDeleteContext(POST_ID),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('pin_not_found')
  })
})

describe('DELETE /api/pinned-posts/[postId] — happy path', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient({
      pinRowExists: true,
      existingPin: { post_id: POST_ID },
    })
  })

  it('returns 204 with no body and filters by (user_id, post_id)', async () => {
    const { DELETE } = await import('@/app/api/pinned-posts/[postId]/route')
    const res = await DELETE(
      makeDeleteRequest(POST_ID) as never,
      makeDeleteContext(POST_ID),
    )
    expect(res.status).toBe(204)
    // 204 must have no body
    const text = await res.text()
    expect(text).toBe('')

    const deleteOps = capturedOps.filter(
      (op) => op.table === 'pinned_posts' && op.op === 'delete',
    )
    expect(deleteOps.length).toBeGreaterThan(0)
    // Filter chain should ultimately apply post_id (the last .eq we capture).
    const lastDelete = deleteOps[deleteOps.length - 1].payload as Record<string, unknown>
    expect(lastDelete.post_id).toBe(POST_ID)
  })
})
