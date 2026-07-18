/**
 * Unit tests for the follow toggle API.
 *
 * Scope of THIS file:
 *  - Pure-logic guards that don't require a DB: auth (401), self-follow
 *    short-circuit (400 with NO DB access), UUID-shape rejection (404),
 *    not-found paths, and the response-shape contract on the happy path.
 *
 * NOT in scope (these go to the E2E suite in Task 6):
 *  - POST→POST idempotence at the DB level: "two POSTs leave a single row".
 *  - DELETE on a missing row is a no-op end-to-end.
 *
 * Unit-testing those scenarios requires either a real Postgres or a mock
 * that essentially re-states the implementation, neither of which would
 * catch a regression in the trigger / upsert semantics. They belong on the
 * integration side.
 *
 * The likes/bookmarks toggle API tests that used to live in this file were
 * removed with the likes/bookmarks features (issue #85).
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
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333'
const BAD_ID = 'not-a-uuid'

// ---------------------------------------------------------------------------
// Tiny request + params helpers
// ---------------------------------------------------------------------------
function makeReq(method: 'POST' | 'DELETE', path: string) {
  return new Request(`http://test${path}`, {
    method,
    headers: { Origin: 'http://localhost:3010' },
  })
}

function userIdParams(id: string) {
  return { params: Promise.resolve({ userId: id }) }
}

// ---------------------------------------------------------------------------
// Builder for a happy-path users/follows client.
// ---------------------------------------------------------------------------
interface ClientOpts {
  userRow?: { id: string } | null
  followerCount?: number
}

function makeClient(opts: ClientOpts = {}) {
  const { userRow = { id: OTHER_USER_ID }, followerCount = 1 } = opts

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
    users: usersHandler,
    follows: joinTableHandler(),
  }

  return {
    from: vi.fn((table: string) => handlers[table] ?? {}),
  }
}

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
