import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/admin
// ---------------------------------------------------------------------------
let adminGateResult: Response | null = null

vi.mock('@/lib/admin', () => ({
  requireAdminApi: vi.fn(async () => adminGateResult),
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
// UUID fixtures
// ---------------------------------------------------------------------------
const ADMIN_ID  = 'aabbccdd-1234-4000-8001-000000000001'
const TARGET_ID = 'aabbccdd-1234-4000-8001-000000000002'
const OTHER_ID  = 'aabbccdd-1234-4000-8001-000000000003'

const BANNED_USER_ROW    = { id: TARGET_ID, username: 'banneduser', banned_at: '2024-01-01T00:00:00.000Z' }
const NOT_BANNED_USER_ROW = { id: TARGET_ID, username: 'freeuser', banned_at: null }

// ---------------------------------------------------------------------------
// Fake client builder
// ---------------------------------------------------------------------------

function makeFakeClient(opts: {
  userRow?: unknown
  updateError?: { message: string } | null
  modActionsError?: { message: string } | null
} = {}) {
  const { userRow = BANNED_USER_ROW, updateError = null, modActionsError = null } = opts

  const modActionsInsertFn = vi.fn(async () => ({ error: modActionsError }))

  return {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: userRow,
            error: userRow ? null : { message: 'not found' },
          })),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: updateError })),
          })),
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
  }
}

function makeRequest(body: unknown) {
  return new Request('http://test/api/admin/unban', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/unban — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    adminGateResult = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    currentFakeClient = makeFakeClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/admin/unban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })
})

describe('POST /api/admin/unban — 404 non-admin', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: OTHER_ID } }
    adminGateResult = new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    currentFakeClient = makeFakeClient()
  })

  it('returns 404 when authed non-admin', async () => {
    const { POST } = await import('@/app/api/admin/unban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('POST /api/admin/unban — 400 invalid_body', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient()
  })

  it('returns 400 when user_id is missing', async () => {
    const { POST } = await import('@/app/api/admin/unban/route')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when user_id is not a UUID', async () => {
    const { POST } = await import('@/app/api/admin/unban/route')
    const res = await POST(makeRequest({ user_id: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })
})

describe('POST /api/admin/unban — 404 user_not_found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient({ userRow: null })
  })

  it('returns 404 when target user does not exist', async () => {
    const { POST } = await import('@/app/api/admin/unban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('user_not_found')
  })
})

describe('POST /api/admin/unban — 400 not_banned', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient({ userRow: NOT_BANNED_USER_ROW })
  })

  it('returns 400 when user is not currently banned', async () => {
    const { POST } = await import('@/app/api/admin/unban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('not_banned')
  })
})

describe('POST /api/admin/unban — 200 happy path', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
  })

  it('unbans user, writes mod_actions, returns 200', async () => {
    const client = makeFakeClient()
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/unban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modCall = (client.modActionsInsertFn.mock.calls as any[][])[0]![0]
    expect(modCall.action).toBe('unban_user')
    expect(modCall.target_type).toBe('user')
    expect(modCall.target_id).toBe(TARGET_ID)
    expect(modCall.metadata.username).toBe('banneduser')
  })
})
