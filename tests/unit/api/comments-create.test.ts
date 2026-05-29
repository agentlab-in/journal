import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
  isAdmin: vi.fn(() => false),
  resolveIsAdmin: vi.fn(async () => false),
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
// Mock: @/lib/comments/depth — easier than mocking the RPC chain
// ---------------------------------------------------------------------------
const depthState: { value: number; throwError: string | null } = {
  value: 1,
  throwError: null,
}

vi.mock('@/lib/comments/depth', () => ({
  getNewCommentDepth: vi.fn(async () => {
    if (depthState.throwError) throw new Error(depthState.throwError)
    return depthState.value
  }),
}))

// ---------------------------------------------------------------------------
// Captured inserts for assertion
// ---------------------------------------------------------------------------
interface InsertRecord { table: string; rows: unknown }
const capturedInserts: InsertRecord[] = []

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const POST_ID = '11111111-1111-4111-8111-111111111111'
const PARENT_ID = '22222222-2222-4222-8222-222222222222'
const NEW_COMMENT_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = 'user-123'

interface PostRowFixture {
  id: string
  deleted_at: string | null
}
interface ParentRowFixture {
  id: string
  post_id: string
  deleted_at: string | null
}

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

function postsHandler(postRow: PostRowFixture | null) {
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

function commentsHandler(opts: {
  parentRow?: ParentRowFixture | null
  insertedRow?: Record<string, unknown>
  insertError?: { message: string } | null
}) {
  const { parentRow, insertedRow, insertError = null } = opts
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve(
            parentRow
              ? { data: parentRow, error: null }
              : { data: null, error: { message: 'not found' } },
          ),
        ),
      })),
    })),
    insert: vi.fn((rows: unknown) => {
      capturedInserts.push({ table: 'comments', rows })
      return {
        select: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve(
              insertError
                ? { data: null, error: insertError }
                : { data: insertedRow ?? null, error: null },
            ),
          ),
        })),
      }
    }),
  }
}

function makeHappyClient(opts: {
  postRow?: PostRowFixture | null
  parentRow?: ParentRowFixture | null
  insertedRow?: Record<string, unknown>
  insertError?: { message: string } | null
} = {}) {
  const {
    postRow = { id: POST_ID, deleted_at: null },
    parentRow = null,
    insertedRow = {
      id: NEW_COMMENT_ID,
      post_id: POST_ID,
      parent_comment_id: null,
      body: 'hello world',
      author_id: USER_ID,
      created_at: '2026-05-30T00:00:00.000Z',
    },
    insertError = null,
  } = opts

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, any> = {
    posts: postsHandler(postRow),
    comments: commentsHandler({ parentRow, insertedRow, insertError }),
  }

  return {
    from: vi.fn((table: string) => handlers[table] ?? {}),
  }
}

// ---------------------------------------------------------------------------
// Request factory
// ---------------------------------------------------------------------------
function makeRequest(body: unknown) {
  return new Request('http://test/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function makeRawRequest(rawBody: string) {
  return new Request('http://test/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/comments — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    capturedInserts.length = 0
    depthState.value = 1
    depthState.throwError = null
    currentFakeClient = makeHappyClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(makeRequest({ post_id: POST_ID, body: 'hi' }) as never)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })
})

describe('POST /api/comments — 400 invalid_json', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedInserts.length = 0
    depthState.value = 1
    depthState.throwError = null
    currentFakeClient = makeHappyClient()
  })

  it('returns 400 invalid_json on malformed body', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(makeRawRequest('{not json') as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_json')
  })
})

describe('POST /api/comments — 400 invalid_body (Zod)', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedInserts.length = 0
    depthState.value = 1
    depthState.throwError = null
    currentFakeClient = makeHappyClient()
  })

  it('returns 400 invalid_body when post_id missing', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(makeRequest({ body: 'hi' }) as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
    expect(Array.isArray(body.issues)).toBe(true)
  })

  it('returns 400 invalid_body when post_id is not a UUID', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(makeRequest({ post_id: 'not-a-uuid', body: 'hi' }) as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })
})

describe('POST /api/comments — 400 empty_body after sanitize', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedInserts.length = 0
    depthState.value = 1
    depthState.throwError = null
    currentFakeClient = makeHappyClient()
  })

  it('returns 400 empty_body when body sanitizes to empty', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(
      makeRequest({ post_id: POST_ID, body: '<script></script>' }) as never,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('empty_body')
  })
})

describe('POST /api/comments — sanitize strips HTML tags before insert', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedInserts.length = 0
    depthState.value = 1
    depthState.throwError = null
    currentFakeClient = makeHappyClient({
      insertedRow: {
        id: NEW_COMMENT_ID,
        post_id: POST_ID,
        parent_comment_id: null,
        body: 'hello world',
        author_id: USER_ID,
        created_at: '2026-05-30T00:00:00.000Z',
      },
    })
  })

  it('strips <b>hello</b> <i>world</i> to hello world in the insert payload', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(
      makeRequest({ post_id: POST_ID, body: '<b>hello</b> <i>world</i>' }) as never,
    )
    expect(res.status).toBe(201)
    const insert = capturedInserts.find((r) => r.table === 'comments')
    expect(insert).toBeDefined()
    const row = insert!.rows as { body: string }
    expect(row.body).toBe('hello world')
  })
})

describe('POST /api/comments — 404 post_not_found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedInserts.length = 0
    depthState.value = 1
    depthState.throwError = null
  })

  it('returns 404 when post is missing', async () => {
    currentFakeClient = makeHappyClient({ postRow: null })
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(makeRequest({ post_id: POST_ID, body: 'hi' }) as never)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('post_not_found')
  })

  it('returns 404 when post is soft-deleted', async () => {
    currentFakeClient = makeHappyClient({
      postRow: { id: POST_ID, deleted_at: '2026-01-01T00:00:00Z' },
    })
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(makeRequest({ post_id: POST_ID, body: 'hi' }) as never)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('post_not_found')
  })
})

describe('POST /api/comments — 400 parent_not_found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedInserts.length = 0
    depthState.value = 2
    depthState.throwError = null
  })

  it('returns 400 parent_not_found when parent is missing', async () => {
    currentFakeClient = makeHappyClient({ parentRow: null })
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(
      makeRequest({ post_id: POST_ID, parent_comment_id: PARENT_ID, body: 'hi' }) as never,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('parent_not_found')
  })

  it('returns 400 parent_not_found when parent belongs to a different post', async () => {
    currentFakeClient = makeHappyClient({
      parentRow: {
        id: PARENT_ID,
        post_id: '99999999-9999-4999-8999-999999999999',
        deleted_at: null,
      },
    })
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(
      makeRequest({ post_id: POST_ID, parent_comment_id: PARENT_ID, body: 'hi' }) as never,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('parent_not_found')
  })

  it('returns 400 parent_not_found when parent is soft-deleted', async () => {
    currentFakeClient = makeHappyClient({
      parentRow: {
        id: PARENT_ID,
        post_id: POST_ID,
        deleted_at: '2026-01-01T00:00:00Z',
      },
    })
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(
      makeRequest({ post_id: POST_ID, parent_comment_id: PARENT_ID, body: 'hi' }) as never,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('parent_not_found')
  })
})

describe('POST /api/comments — 400 depth_exceeded', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedInserts.length = 0
    depthState.value = 6
    depthState.throwError = null
    currentFakeClient = makeHappyClient({
      parentRow: { id: PARENT_ID, post_id: POST_ID, deleted_at: null },
    })
  })

  it('returns 400 depth_exceeded when depth > 5', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(
      makeRequest({ post_id: POST_ID, parent_comment_id: PARENT_ID, body: 'hi' }) as never,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('depth_exceeded')
    expect(body.max).toBe(5)
  })
})

describe('POST /api/comments — 201 happy path (root)', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedInserts.length = 0
    depthState.value = 1
    depthState.throwError = null
    currentFakeClient = makeHappyClient({
      insertedRow: {
        id: NEW_COMMENT_ID,
        post_id: POST_ID,
        parent_comment_id: null,
        body: 'hello world',
        author_id: USER_ID,
        created_at: '2026-05-30T00:00:00.000Z',
      },
    })
  })

  it('returns 201 with inserted row for root comment (no parent)', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(
      makeRequest({ post_id: POST_ID, body: 'hello world' }) as never,
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({
      id: NEW_COMMENT_ID,
      post_id: POST_ID,
      parent_comment_id: null,
      body: 'hello world',
      author_id: USER_ID,
      created_at: '2026-05-30T00:00:00.000Z',
    })

    const insert = capturedInserts.find((r) => r.table === 'comments')
    expect(insert).toBeDefined()
    const row = insert!.rows as Record<string, unknown>
    expect(row.parent_comment_id).toBeNull()
    expect(row.author_id).toBe(USER_ID)
    expect(row.post_id).toBe(POST_ID)
  })
})

describe('POST /api/comments — 201 happy path (reply at depth 4)', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedInserts.length = 0
    depthState.value = 4
    depthState.throwError = null
    currentFakeClient = makeHappyClient({
      parentRow: { id: PARENT_ID, post_id: POST_ID, deleted_at: null },
      insertedRow: {
        id: NEW_COMMENT_ID,
        post_id: POST_ID,
        parent_comment_id: PARENT_ID,
        body: 'a reply',
        author_id: USER_ID,
        created_at: '2026-05-30T00:00:00.000Z',
      },
    })
  })

  it('returns 201 with inserted row for reply at depth 4 (still under 5)', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(
      makeRequest({
        post_id: POST_ID,
        parent_comment_id: PARENT_ID,
        body: 'a reply',
      }) as never,
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.parent_comment_id).toBe(PARENT_ID)
    expect(body.id).toBe(NEW_COMMENT_ID)
  })
})
