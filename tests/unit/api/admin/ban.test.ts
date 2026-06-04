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
//
// New route shape (W4):
//   public.users           SELECT id/username/banned_at; UPDATE banned_at
//   next_auth.sessions     SELECT id (trigger-cleanup verification — no DELETE)
//   next_auth.users        SELECT email (fingerprint source)
//   next_auth.accounts     SELECT providerAccountId (fingerprint source)
//   public.ban_fingerprints UPSERT
//   public.mod_actions     INSERT
// ---------------------------------------------------------------------------

interface FakeClientOpts {
  userRow?: unknown
  updateError?: { message: string } | null
  sessionsRemaining?: unknown[]
  sessionsSelectError?: { message: string } | null
  modActionsError?: { message: string } | null
  fingerprintError?: { message: string } | null
  emailRow?: { email: string | null } | null
  accountRow?: { providerAccountId: string | null } | null
  emailLookupError?: { message: string } | null
  accountLookupError?: { message: string } | null
}

function makeFakeClient(opts: FakeClientOpts = {}) {
  const {
    userRow = VALID_USER_ROW,
    updateError = null,
    sessionsRemaining = [],
    sessionsSelectError = null,
    modActionsError = null,
    fingerprintError = null,
    emailRow = { email: 'test@example.com' },
    accountRow = { providerAccountId: '12345' },
    emailLookupError = null,
    accountLookupError = null,
  } = opts

  const fingerprintUpsertFn = vi.fn(async () => ({ error: fingerprintError }))

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
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: updateError })),
          })),
        }
        return usersChain
      }
      if (table === 'mod_actions') {
        return {
          insert: vi.fn(async () => ({ error: modActionsError })),
        }
      }
      if (table === 'ban_fingerprints') {
        return {
          upsert: fingerprintUpsertFn,
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
          // SELECT id FROM next_auth.sessions WHERE userId = ?
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn(async () => ({
              data: sessionsRemaining,
              error: sessionsSelectError,
            })),
          }
        }
        if (table === 'users') {
          // SELECT email FROM next_auth.users WHERE id = ?
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({
              data: emailLookupError ? null : emailRow,
              error: emailLookupError,
            })),
          }
        }
        if (table === 'accounts') {
          // SELECT providerAccountId FROM next_auth.accounts WHERE userId=? AND provider='github'
          const accountsChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({
              data: accountLookupError ? null : accountRow,
              error: accountLookupError,
            })),
          }
          return accountsChain
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        }
      }),
    })),
    fingerprintUpsertFn,
  }
}

function makeHappyFakeClient(opts: {
  modActionsError?: { message: string } | null
  sessionsRemaining?: unknown[]
} = {}) {
  const { modActionsError = null, sessionsRemaining = [] } = opts

  const usersUpdateEqFn = vi.fn(async () => ({ error: null }))
  const usersUpdateChain = { eq: usersUpdateEqFn }

  const sessionsSelectEqFn = vi.fn(async () => ({
    data: sessionsRemaining,
    error: null,
  }))
  const sessionsChain = {
    select: vi.fn().mockReturnThis(),
    eq: sessionsSelectEqFn,
  }

  const naUsersChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: { email: 'test@example.com' }, error: null })),
  }

  const naAccountsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: { providerAccountId: '12345' }, error: null })),
  }

  const modActionsInsertFn = vi.fn(async () => ({ error: modActionsError }))
  const fingerprintUpsertFn = vi.fn(async () => ({ error: null }))

  const schemaFn = vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'sessions') return sessionsChain
      if (table === 'users') return naUsersChain
      if (table === 'accounts') return naAccountsChain
      return naUsersChain
    }),
  }))

  const fromFn = vi.fn((table: string) => {
    if (table === 'users') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: VALID_USER_ROW, error: null })),
        update: vi.fn(() => usersUpdateChain),
      }
    }
    if (table === 'mod_actions') {
      return { insert: modActionsInsertFn }
    }
    if (table === 'ban_fingerprints') {
      return { upsert: fingerprintUpsertFn }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    }
  })

  return {
    from: fromFn,
    schema: schemaFn,
    usersUpdateEqFn,
    modActionsInsertFn,
    sessionsSelectEqFn,
    schemaFn,
    fingerprintUpsertFn,
  }
}

function makeRequest(body: unknown) {
  return new Request('http://test/api/admin/ban', {
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

describe('POST /api/admin/ban — 500 ban_partial when trigger leaves sessions behind', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient({ sessionsRemaining: [{ id: 'leftover-1' }] })
  })

  it('returns 500 ban_partial when sessions remain after UPDATE (trigger inactive)', async () => {
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('ban_partial')
  })

  it('returns 500 ban_partial when sessions SELECT errors', async () => {
    currentFakeClient = makeFakeClient({
      sessionsSelectError: { message: 'rpc broke' },
    })
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('ban_partial')
  })
})

describe('POST /api/admin/ban — 500 ban_partial when fingerprint write paths fail', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
  })

  it('returns 500 ban_partial when next_auth.users email lookup errors', async () => {
    currentFakeClient = makeFakeClient({
      emailLookupError: { message: 'rpc broke' },
    })
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('ban_partial')
  })

  it('returns 500 ban_partial when next_auth.accounts lookup errors', async () => {
    currentFakeClient = makeFakeClient({
      accountLookupError: { message: 'rpc broke' },
    })
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('ban_partial')
  })

  it('returns 500 ban_partial when neither email nor providerAccountId is available', async () => {
    currentFakeClient = makeFakeClient({
      emailRow: { email: null },
      accountRow: { providerAccountId: null },
    })
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('ban_partial')
  })

  it('returns 500 ban_partial when ban_fingerprints upsert errors', async () => {
    currentFakeClient = makeFakeClient({
      fingerprintError: { message: 'unique violation' },
    })
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('ban_partial')
  })
})

describe('POST /api/admin/ban — 200 happy path', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
  })

  it('bans user, verifies sessions cleared, writes fingerprint + mod_actions, returns 200', async () => {
    const client = makeHappyFakeClient()
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/ban/route')
    const res = await POST(makeRequest({ user_id: TARGET_ID, reason: 'violates ToS' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Users UPDATE was called
    expect(client.from).toHaveBeenCalledWith('users')

    // next_auth schema used for sessions verification + email/account lookup
    expect(client.schemaFn).toHaveBeenCalledWith('next_auth')

    // Ban fingerprint upsert was issued
    expect(client.fingerprintUpsertFn).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fpCall = (client.fingerprintUpsertFn.mock.calls as any[][])[0]![0]
    expect(typeof fpCall.email_hash).toBe('string')
    expect(fpCall.email_hash).toHaveLength(64) // sha256 hex
    expect(fpCall.provider_account_id).toBe('12345')
    expect(fpCall.user_id).toBe(TARGET_ID)

    // mod_actions INSERT was called
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modCall = (client.modActionsInsertFn.mock.calls as any[][])[0]![0]
    expect(modCall.action).toBe('ban_user')
    expect(modCall.target_type).toBe('user')
    expect(modCall.target_id).toBe(TARGET_ID)
    expect(modCall.reason).toBe('violates ToS')
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

  it('verifies next_auth.sessions was queried for the target userId', async () => {
    const client = makeHappyFakeClient()
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/ban/route')
    await POST(makeRequest({ user_id: TARGET_ID, reason: 'spam' }))

    expect(client.schemaFn).toHaveBeenCalledWith('next_auth')
    // sessions SELECT terminator received the userId equality
    expect(client.sessionsSelectEqFn).toHaveBeenCalledWith('userId', TARGET_ID)
  })
})
