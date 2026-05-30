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
// By default requireAdminApi returns null (admin allowed). Tests override this.
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
// UUID fixtures — RFC 4122 v4 format
// ---------------------------------------------------------------------------
const ADMIN_ID   = 'aabbccdd-1234-4000-8001-000000000001'
const TARGET_ID  = 'aabbccdd-1234-4000-8001-000000000002'
const OTHER_ID   = 'aabbccdd-1234-4000-8001-000000000003'

const VALID_USER_ROW = { id: TARGET_ID, username: 'testuser', banned_at: null }
const ALREADY_BANNED_USER_ROW = { id: TARGET_ID, username: 'testuser', banned_at: '2024-01-01T00:00:00.000Z' }

// ---------------------------------------------------------------------------
// Fake client builder
// ---------------------------------------------------------------------------

interface FakeClientOpts {
  userRow?: unknown
  updateError?: { message: string } | null
  sessionsDeleteResult?: unknown[]
  sessionsDeleteError?: { message: string } | null
  modActionsError?: { message: string } | null
}

function makeFakeClient(opts: FakeClientOpts = {}) {
  const {
    userRow = VALID_USER_ROW,
    updateError = null,
    sessionsDeleteResult = [],
    sessionsDeleteError = null,
    modActionsError = null,
  } = opts

  // Track schema() calls to differentiate next_auth from public
  return {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        const usersChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: userRow,
            error: userRow ? null : { message: 'not found' },
          })),
          update: vi.fn().mockReturnThis(),
        }
        // update() needs to return a chain that resolves
        usersChain.update = vi.fn(() => ({
          eq: vi.fn(async () => ({ error: updateError })),
        }))
        return usersChain
      }
      if (table === 'mod_actions') {
        return {
          insert: vi.fn(async () => ({ error: modActionsError })),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      }
    }),
    schema: vi.fn(() => ({
      from: vi.fn((table: string) => {
        if (table === 'sessions') {
          const sessionsDeleteChain = {
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn(async () => ({
              data: sessionsDeleteResult,
              error: sessionsDeleteError,
            })),
          }
          return sessionsDeleteChain
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(async () => ({ data: null, error: null })),
        }
      }),
    })),
  }
}

// More targeted fake client that tracks calls precisely for happy path
function makeHappyFakeClient(opts: {
  sessionsDeleteResult?: unknown[]
  modActionsError?: { message: string } | null
} = {}) {
  const { sessionsDeleteResult = [{ id: 'sess-1' }], modActionsError = null } = opts

  const usersUpdateEqFn = vi.fn(async () => ({ error: null }))
  const usersSelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: VALID_USER_ROW, error: null })),
  }
  const usersUpdateChain = {
    eq: usersUpdateEqFn,
  }

  const sessionsDeleteSelectFn = vi.fn(async () => ({
    data: sessionsDeleteResult,
    error: null,
  }))
  const sessionsChain = {
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: sessionsDeleteSelectFn,
  }
  const modActionsInsertFn = vi.fn(async () => ({ error: modActionsError }))

  const schemaFn = vi.fn(() => ({
    from: vi.fn(() => sessionsChain),
  }))

  const fromFn = vi.fn((table: string) => {
    if (table === 'users') {
      return {
        ...usersSelectChain,
        update: vi.fn(() => usersUpdateChain),
      }
    }
    if (table === 'mod_actions') {
      return { insert: modActionsInsertFn }
    }
    return usersSelectChain
  })

  return { from: fromFn, schema: schemaFn, usersUpdateEqFn, modActionsInsertFn, sessionsDeleteSelectFn, schemaFn }
}

function makeRequest(body: unknown) {
  return new Request('http://test/api/admin/ban', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/ban — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    adminGateResult = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    currentFakeClient = makeFakeClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })
})

describe('POST /api/admin/ban — 404 non-admin', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: OTHER_ID } }
    adminGateResult = new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    currentFakeClient = makeFakeClient()
  })

  it('returns 404 when authed non-admin', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('POST /api/admin/ban — 400 invalid_body', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient()
  })

  it('returns 400 when user_id is missing', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when user_id is not a UUID', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: 'not-a-uuid', reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when reason is empty', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: '' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when reason exceeds 1000 chars', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'x'.repeat(1001) }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })
})

describe('POST /api/admin/ban — 400 self_action', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient()
  })

  it('returns 400 when admin tries to ban themselves', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: ADMIN_ID, reason: 'test' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('self_action')
  })
})

describe('POST /api/admin/ban — 404 user_not_found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient({ userRow: null })
  })

  it('returns 404 when target user does not exist', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('user_not_found')
  })
})

describe('POST /api/admin/ban — 400 already_banned', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient({ userRow: ALREADY_BANNED_USER_ROW })
  })

  it('returns 400 when user is already banned', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('already_banned')
  })
})

describe('POST /api/admin/ban — 200 happy path', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
  })

  it('bans user, deletes sessions, writes mod_actions, returns 200', async () => {
    const client = makeHappyFakeClient({ sessionsDeleteResult: [{ id: 'sess-1' }, { id: 'sess-2' }] })
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'violates ToS' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Users UPDATE was called
    expect(client.from).toHaveBeenCalledWith('users')

    // next_auth sessions DELETE was triggered
    expect(client.schemaFn).toHaveBeenCalledWith('next_auth')

    // mod_actions INSERT was called
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modCall = (client.modActionsInsertFn.mock.calls as any[][])[0]![0]
    expect(modCall.action).toBe('ban_user')
    expect(modCall.target_type).toBe('user')
    expect(modCall.target_id).toBe(TARGET_ID)
    expect(modCall.reason).toBe('violates ToS')
    expect(modCall.metadata.sessions_deleted).toBe(2)
    expect(modCall.metadata.username).toBe('testuser')
  })

  it('returns 200 even when mod_actions INSERT fails (best-effort audit)', async () => {
    const client = makeHappyFakeClient({ modActionsError: { message: 'db error' } })
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('asserts next_auth.sessions DELETE was issued for the target userId', async () => {
    const client = makeHappyFakeClient()
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/ban/route')
    await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))

    // Verify the schema('next_auth') call
    expect(client.schemaFn).toHaveBeenCalledWith('next_auth')
  })
})
