/**
 * Unit tests for the engagement toggle APIs (likes, bookmarks, follows).
 *
 * Scope of THIS file:
 *  - Pure-logic guards that don't require a DB: auth (401), self-follow
 *    short-circuit (400 with NO DB access), UUID-shape rejection (404),
 *    not-found paths, and the response-shape contract on the happy path.
 *
 * NOT in scope (these go to the E2E suite in Task 6):
 *  - Trigger correctness: "after a like insert, posts.like_count matches
 *    COUNT(*) on public.likes".
 *  - POST→POST idempotence at the DB level: "two POSTs leave a single row".
 *  - DELETE on a missing row is a no-op end-to-end.
 *
 * Unit-testing those scenarios requires either a real Postgres or a mock
 * that essentially re-states the implementation, neither of which would
 * catch a regression in the trigger / upsert semantics. They belong on the
 * integration side.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/admin — each test assigns its own client.
// `accessTrap()` returns a Proxy that throws on ANY property access, so we
// can assert a code path NEVER touches the DB.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

function accessTrap(label: string) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `unexpected DB access on ${label}: tried to read .${String(prop)}`,
        )
      },
    },
  )
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const USER_ID = '11111111-1111-4111-8111-111111111111'
const POST_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333'
const BAD_ID = 'not-a-uuid'

// ---------------------------------------------------------------------------
// Tiny request + params helpers
// ---------------------------------------------------------------------------
function makeReq(method: 'POST' | 'DELETE', path: string) {
  return new Request(`http://test${path}`, { method })
}

function postIdParams(id: string) {
  return { params: Promise.resolve({ postId: id }) }
}

function userIdParams(id: string) {
  return { params: Promise.resolve({ userId: id }) }
}

// ---------------------------------------------------------------------------
// Builder for a happy-path posts/likes/bookmarks/users/follows client.
// ---------------------------------------------------------------------------
interface ClientOpts {
  postRow?: { id: string; deleted_at: string | null } | null
  userRow?: { id: string } | null
  likeCount?: number
  followerCount?: number
}

function makeClient(opts: ClientOpts = {}) {
  const {
    postRow = { id: POST_ID, deleted_at: null },
    userRow = { id: OTHER_USER_ID },
    likeCount = 1,
    followerCount = 1,
  } = opts

  // The `posts` table answers TWO different reads:
  //   select('id, deleted_at').eq('id', ...).single()  → existence check
  //   select('like_count').eq('id', ...).single()      → post-mutation count
  const postsHandler = {
    select: vi.fn((cols: string) => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => {
          if (cols === 'like_count') {
            return Promise.resolve({ data: { like_count: likeCount }, error: null })
          }
          return Promise.resolve(
            postRow
              ? { data: postRow, error: null }
              : { data: null, error: { message: 'not found' } },
          )
        }),
      })),
    })),
  }

  // `users` answers existence check + follower_count read
  const usersHandler = {
    select: vi.fn((cols: string) => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => {
          if (cols === 'follower_count') {
            return Promise.resolve({
              data: { follower_count: followerCount },
              error: null,
            })
          }
          return Promise.resolve(
            userRow
              ? { data: userRow, error: null }
              : { data: null, error: { message: 'not found' } },
          )
        }),
      })),
    })),
  }

  // upsert returns the row; delete chains .eq().eq()
  const joinTableHandler = () => ({
    upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    delete: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, any> = {
    posts: postsHandler,
    users: usersHandler,
    likes: joinTableHandler(),
    bookmarks: joinTableHandler(),
    follows: joinTableHandler(),
  }

  return {
    from: vi.fn((table: string) => handlers[table] ?? {}),
  }
}

// ===========================================================================
// /api/likes/[postId]
// ===========================================================================
describe('POST /api/likes/[postId]', () => {
  beforeEach(() => {
    sessionState.value = null
    currentFakeClient = makeClient()
  })

  it('returns 401 when no session', async () => {
    sessionState.value = null
    const { POST } = await import('@/app/api/likes/[postId]/route')
    const res = await POST(makeReq('POST', `/api/likes/${POST_ID}`), postIdParams(POST_ID))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 404 for malformed UUID without hitting DB', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = accessTrap('likes/postId DB')
    const { POST } = await import('@/app/api/likes/[postId]/route')
    const res = await POST(makeReq('POST', `/api/likes/${BAD_ID}`), postIdParams(BAD_ID))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'post_not_found' })
  })

  it('returns 404 when post does not exist', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient({ postRow: null })
    const { POST } = await import('@/app/api/likes/[postId]/route')
    const res = await POST(makeReq('POST', `/api/likes/${POST_ID}`), postIdParams(POST_ID))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'post_not_found' })
  })

  it('returns 404 when post is soft-deleted', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient({
      postRow: { id: POST_ID, deleted_at: '2026-01-01T00:00:00Z' },
    })
    const { POST } = await import('@/app/api/likes/[postId]/route')
    const res = await POST(makeReq('POST', `/api/likes/${POST_ID}`), postIdParams(POST_ID))
    expect(res.status).toBe(404)
  })

  it('returns 200 { liked: true, like_count } on happy path', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient({ likeCount: 5 })
    const { POST } = await import('@/app/api/likes/[postId]/route')
    const res = await POST(makeReq('POST', `/api/likes/${POST_ID}`), postIdParams(POST_ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ liked: true, like_count: 5 })
  })
})

describe('DELETE /api/likes/[postId]', () => {
  beforeEach(() => {
    sessionState.value = null
    currentFakeClient = makeClient()
  })

  it('returns 401 when no session', async () => {
    const { DELETE } = await import('@/app/api/likes/[postId]/route')
    const res = await DELETE(
      makeReq('DELETE', `/api/likes/${POST_ID}`),
      postIdParams(POST_ID),
    )
    expect(res.status).toBe(401)
  })

  it('returns 200 { liked: false, like_count } on happy path', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient({ likeCount: 0 })
    const { DELETE } = await import('@/app/api/likes/[postId]/route')
    const res = await DELETE(
      makeReq('DELETE', `/api/likes/${POST_ID}`),
      postIdParams(POST_ID),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ liked: false, like_count: 0 })
  })
})

// ===========================================================================
// /api/bookmarks/[postId]
// ===========================================================================
describe('POST /api/bookmarks/[postId]', () => {
  beforeEach(() => {
    sessionState.value = null
    currentFakeClient = makeClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/bookmarks/[postId]/route')
    const res = await POST(
      makeReq('POST', `/api/bookmarks/${POST_ID}`),
      postIdParams(POST_ID),
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 for malformed UUID without hitting DB', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = accessTrap('bookmarks/postId DB')
    const { POST } = await import('@/app/api/bookmarks/[postId]/route')
    const res = await POST(
      makeReq('POST', `/api/bookmarks/${BAD_ID}`),
      postIdParams(BAD_ID),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when post missing', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient({ postRow: null })
    const { POST } = await import('@/app/api/bookmarks/[postId]/route')
    const res = await POST(
      makeReq('POST', `/api/bookmarks/${POST_ID}`),
      postIdParams(POST_ID),
    )
    expect(res.status).toBe(404)
  })

  it('returns 200 { bookmarked: true } (no count field) on happy path', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient()
    const { POST } = await import('@/app/api/bookmarks/[postId]/route')
    const res = await POST(
      makeReq('POST', `/api/bookmarks/${POST_ID}`),
      postIdParams(POST_ID),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ bookmarked: true })
    expect('bookmark_count' in body).toBe(false)
  })
})

describe('DELETE /api/bookmarks/[postId]', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient()
  })

  it('returns 200 { bookmarked: false } on happy path', async () => {
    const { DELETE } = await import('@/app/api/bookmarks/[postId]/route')
    const res = await DELETE(
      makeReq('DELETE', `/api/bookmarks/${POST_ID}`),
      postIdParams(POST_ID),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ bookmarked: false })
  })
})

// ===========================================================================
// /api/follows/[userId]
// ===========================================================================
describe('POST /api/follows/[userId]', () => {
  beforeEach(() => {
    sessionState.value = null
    currentFakeClient = makeClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/follows/[userId]/route')
    const res = await POST(
      makeReq('POST', `/api/follows/${OTHER_USER_ID}`),
      userIdParams(OTHER_USER_ID),
    )
    expect(res.status).toBe(401)
  })

  // THE key brief-required test: self-follow short-circuits BEFORE any DB
  // call. The fake client is an accessTrap — if the route reads .from(...)
  // or any other property, the test fails with a clear error.
  it('returns 400 cannot_follow_self WITHOUT touching the DB', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = accessTrap('follows/self DB')
    const { POST } = await import('@/app/api/follows/[userId]/route')
    const res = await POST(
      makeReq('POST', `/api/follows/${USER_ID}`),
      userIdParams(USER_ID),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'cannot_follow_self' })
  })

  it('returns 404 for malformed UUID without hitting DB', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = accessTrap('follows/userId DB')
    const { POST } = await import('@/app/api/follows/[userId]/route')
    const res = await POST(
      makeReq('POST', `/api/follows/${BAD_ID}`),
      userIdParams(BAD_ID),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'user_not_found' })
  })

  it('returns 404 when target user does not exist', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient({ userRow: null })
    const { POST } = await import('@/app/api/follows/[userId]/route')
    const res = await POST(
      makeReq('POST', `/api/follows/${OTHER_USER_ID}`),
      userIdParams(OTHER_USER_ID),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'user_not_found' })
  })

  it('returns 200 { following: true, follower_count } on happy path', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient({ followerCount: 7 })
    const { POST } = await import('@/app/api/follows/[userId]/route')
    const res = await POST(
      makeReq('POST', `/api/follows/${OTHER_USER_ID}`),
      userIdParams(OTHER_USER_ID),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ following: true, follower_count: 7 })
  })
})

describe('DELETE /api/follows/[userId]', () => {
  beforeEach(() => {
    sessionState.value = null
    currentFakeClient = makeClient()
  })

  it('returns 400 cannot_follow_self WITHOUT touching the DB', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = accessTrap('follows/self DELETE DB')
    const { DELETE } = await import('@/app/api/follows/[userId]/route')
    const res = await DELETE(
      makeReq('DELETE', `/api/follows/${USER_ID}`),
      userIdParams(USER_ID),
    )
    expect(res.status).toBe(400)
  })

  it('returns 200 { following: false, follower_count } on happy path', async () => {
    sessionState.value = { user: { id: USER_ID } }
    currentFakeClient = makeClient({ followerCount: 2 })
    const { DELETE } = await import('@/app/api/follows/[userId]/route')
    const res = await DELETE(
      makeReq('DELETE', `/api/follows/${OTHER_USER_ID}`),
      userIdParams(OTHER_USER_ID),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ following: false, follower_count: 2 })
  })
})
