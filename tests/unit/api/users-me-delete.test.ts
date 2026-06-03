import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — mirror the PATCH test shape so module-loading rules stay aligned.
// ---------------------------------------------------------------------------

const sessionState: { value: { user: { id: string } } | null } = { value: null }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

vi.mock('@/lib/logging/error-log', () => ({
  logRouteError: vi.fn(),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'

// ---------------------------------------------------------------------------
// Fake supabase client builder
//
// publicUpdateResults is a queue of error objects (or null for success) so
// individual tests can rehearse retry-on-23505 behaviour without rewriting
// the whole client each time.
// ---------------------------------------------------------------------------

interface FakeOpts {
  publicUpdateResults?: Array<{ message: string; code?: string } | null>
  nextAuthUsersUpdateError?: { message: string } | null
  accountsDeleteError?: { message: string } | null
  sessionsDeleteError?: { message: string } | null
}

function makeFakeClient(opts: FakeOpts = {}) {
  const {
    publicUpdateResults = [null],
    nextAuthUsersUpdateError = null,
    accountsDeleteError = null,
    sessionsDeleteError = null,
  } = opts

  const publicUpdatePayloads: Array<Record<string, unknown>> = []
  let publicUpdateCallIdx = 0

  const nextAuthUsersUpdatePayloads: Array<Record<string, unknown>> = []

  const nextAuthAccountsDeleteFilters: Array<{ field: string; value: unknown }> = []
  const nextAuthSessionsDeleteFilters: Array<{ field: string; value: unknown }> = []

  const nextAuthSchema = {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            nextAuthUsersUpdatePayloads.push(payload)
            return {
              eq: vi.fn(async () => ({ error: nextAuthUsersUpdateError })),
            }
          }),
        }
      }
      if (table === 'accounts') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(async (field: string, value: unknown) => {
              nextAuthAccountsDeleteFilters.push({ field, value })
              return { error: accountsDeleteError }
            }),
          })),
        }
      }
      if (table === 'sessions') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(async (field: string, value: unknown) => {
              nextAuthSessionsDeleteFilters.push({ field, value })
              return { error: sessionsDeleteError }
            }),
          })),
        }
      }
      return {}
    }),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => ({
            eq: vi.fn(async () => {
              publicUpdatePayloads.push(payload)
              const result = publicUpdateResults[publicUpdateCallIdx] ?? null
              publicUpdateCallIdx++
              return { error: result }
            }),
          })),
        }
      }
      return {}
    }),
    schema: vi.fn((s: string) => {
      if (s === 'next_auth') return nextAuthSchema
      return { from: vi.fn(() => ({})) }
    }),
    // expose internals so tests can assert
    publicUpdatePayloads,
    nextAuthUsersUpdatePayloads,
    nextAuthAccountsDeleteFilters,
    nextAuthSessionsDeleteFilters,
  }
}

function makeRequest(body: unknown, opts: { raw?: boolean } = {}) {
  return new Request('http://test/api/users/me', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: opts.raw ? (body as string) : JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DELETE /api/users/me — authentication + confirmation', () => {
  beforeEach(() => {
    currentFakeClient = makeFakeClient()
  })

  it('returns 401 when no session', async () => {
    sessionState.value = null
    const { DELETE } = await import('@/app/api/users/me/route')
    const res = await DELETE(makeRequest({ confirm: 'delete' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 confirm_required when body is missing', async () => {
    sessionState.value = { user: { id: USER_ID } }
    const { DELETE } = await import('@/app/api/users/me/route')
    const res = await DELETE(makeRequest('', { raw: true }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('confirm_required')
  })

  it('returns 400 confirm_required when confirm string is wrong', async () => {
    sessionState.value = { user: { id: USER_ID } }
    const { DELETE } = await import('@/app/api/users/me/route')
    const res = await DELETE(makeRequest({ confirm: 'yes' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('confirm_required')
  })
})

describe('DELETE /api/users/me — happy path', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
  })

  it('anonymises public.users with a deleted-<id> handle', async () => {
    const client = makeFakeClient()
    currentFakeClient = client

    const { DELETE } = await import('@/app/api/users/me/route')
    const res = await DELETE(makeRequest({ confirm: 'delete' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.username).toBe('string')
    expect(body.username).toMatch(/^deleted-[0-9a-f]{8}$/)

    expect(client.publicUpdatePayloads).toHaveLength(1)
    const payload = client.publicUpdatePayloads[0]
    expect(payload.username).toMatch(/^deleted-[0-9a-f]{8}$/)
    expect(payload.display_name).toBe(payload.username)
    expect(payload.bio).toBeNull()
    expect(payload.avatar_url).toBeNull()
    expect(payload.github_login).toBeNull()
  })

  it('clears identifying columns on next_auth.users', async () => {
    const client = makeFakeClient()
    currentFakeClient = client
    const { DELETE } = await import('@/app/api/users/me/route')
    await DELETE(makeRequest({ confirm: 'delete' }))

    expect(client.nextAuthUsersUpdatePayloads).toEqual([
      { email: null, name: null, image: null, github_login: null },
    ])
  })

  it('deletes both next_auth.accounts and next_auth.sessions filtered by userId', async () => {
    const client = makeFakeClient()
    currentFakeClient = client
    const { DELETE } = await import('@/app/api/users/me/route')
    await DELETE(makeRequest({ confirm: 'delete' }))

    expect(client.nextAuthAccountsDeleteFilters).toEqual([{ field: 'userId', value: USER_ID }])
    expect(client.nextAuthSessionsDeleteFilters).toEqual([{ field: 'userId', value: USER_ID }])
  })
})

describe('DELETE /api/users/me — handle collision retry', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
  })

  it('retries with a fresh handle on a unique-violation error code 23505', async () => {
    const collide = { message: 'duplicate key value violates unique constraint', code: '23505' }
    const client = makeFakeClient({ publicUpdateResults: [collide, collide, null] })
    currentFakeClient = client

    const { DELETE } = await import('@/app/api/users/me/route')
    const res = await DELETE(makeRequest({ confirm: 'delete' }))
    expect(res.status).toBe(200)
    expect(client.publicUpdatePayloads).toHaveLength(3)

    // Each retry produced a different handle.
    const handles = client.publicUpdatePayloads.map((p) => p.username)
    expect(new Set(handles).size).toBe(3)
  })

  it('does NOT retry on a non-unique-violation error', async () => {
    const other = { message: 'permission denied', code: '42501' }
    const client = makeFakeClient({ publicUpdateResults: [other, null] })
    currentFakeClient = client

    const { DELETE } = await import('@/app/api/users/me/route')
    const res = await DELETE(makeRequest({ confirm: 'delete' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('delete_failed')
    expect(client.publicUpdatePayloads).toHaveLength(1)
  })

  it('gives up after MAX_HANDLE_RETRIES collisions', async () => {
    const collide = { message: 'dup', code: '23505' }
    const client = makeFakeClient({
      publicUpdateResults: [collide, collide, collide, collide, collide],
    })
    currentFakeClient = client

    const { DELETE } = await import('@/app/api/users/me/route')
    const res = await DELETE(makeRequest({ confirm: 'delete' }))
    expect(res.status).toBe(500)
    expect(client.publicUpdatePayloads).toHaveLength(5)
  })
})

describe('DELETE /api/users/me — partial-failure surface', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
  })

  it('returns 500 partial_delete when next_auth.users update fails after public.users succeeded', async () => {
    const client = makeFakeClient({
      nextAuthUsersUpdateError: { message: 'auth users fail' },
    })
    currentFakeClient = client

    const { DELETE } = await import('@/app/api/users/me/route')
    const res = await DELETE(makeRequest({ confirm: 'delete' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('partial_delete')
  })

  it('is idempotent against a second call (handle already anonymised → still succeeds)', async () => {
    // Two back-to-back deletes — both should reach 200 because each picks a
    // fresh deleted-<id> handle (the first call replaced username with
    // `deleted-abc12345`; the second call rewrites it to a new value).
    const client1 = makeFakeClient()
    currentFakeClient = client1
    const { DELETE } = await import('@/app/api/users/me/route')
    const res1 = await DELETE(makeRequest({ confirm: 'delete' }))
    expect(res1.status).toBe(200)

    const client2 = makeFakeClient()
    currentFakeClient = client2
    const res2 = await DELETE(makeRequest({ confirm: 'delete' }))
    expect(res2.status).toBe(200)
  })
})
