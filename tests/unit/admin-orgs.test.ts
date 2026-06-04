/**
 * Unit tests for the Phase 11 T6 admin org surface:
 *   - POST /api/admin/orgs/ban
 *   - POST /api/admin/orgs/unban
 *   - lib/admin/search-orgs.ts
 *
 * Mocking strategy mirrors tests/unit/api/admin/ban.test.ts:
 *   - `@/lib/auth.getSession` returns `sessionState.value`
 *   - `@/lib/admin.requireAdminApi` returns `adminGateResult` (default null)
 *   - `@/lib/route-guard.guardMutatingRequest` always succeeds
 *   - `@/lib/supabase/admin.createAdminSupabaseClient` returns `currentFakeClient`
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must register BEFORE importing the modules under test.
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
}))

let adminGateResult: Response | null = null

vi.mock('@/lib/admin', () => ({
  requireAdminApi: vi.fn(async () => adminGateResult),
}))

vi.mock('@/lib/route-guard', () => ({
  guardMutatingRequest: vi.fn(async () => ({ failed: false })),
}))

vi.mock('@/lib/logging/error-log', () => ({
  logRouteError: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

// ---------------------------------------------------------------------------
// UUID fixtures
// ---------------------------------------------------------------------------
const ADMIN_ID = 'aabbccdd-1234-4000-8001-000000000001'
const ORG_ID   = 'aabbccdd-1234-4000-8001-000000000010'
const OTHER_ID = 'aabbccdd-1234-4000-8001-000000000099'

interface CapturedOp {
  table: string
  op: 'insert' | 'update'
  payload?: unknown
}
const capturedOps: CapturedOp[] = []

// ---------------------------------------------------------------------------
// Fake supabase client for the ban/unban routes.
// ---------------------------------------------------------------------------
interface RouteClientOpts {
  org?: { id: string; slug: string; banned_at: string | null } | null
  updateError?: { message: string } | null
}

function makeRouteClient(opts: RouteClientOpts = {}) {
  const { org = null, updateError = null } = opts

  return {
    from: vi.fn((table: string) => {
      if (table === 'orgs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: org,
                error: null,
              })),
            })),
          })),
          update: vi.fn((payload: unknown) => {
            capturedOps.push({ table: 'orgs', op: 'update', payload })
            return {
              eq: vi.fn(async () => ({ error: updateError })),
            }
          }),
        }
      }
      if (table === 'mod_actions') {
        return {
          insert: vi.fn(async (payload: unknown) => {
            capturedOps.push({ table: 'mod_actions', op: 'insert', payload })
            return { error: null }
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    }),
  }
}

function makeRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  sessionState.value = null
  adminGateResult = null
  currentFakeClient = {}
  capturedOps.length = 0
})

// ===========================================================================
// POST /api/admin/orgs/ban
// ===========================================================================
describe('POST /api/admin/orgs/ban', () => {
  it('returns 403/404 when caller is not admin', async () => {
    sessionState.value = { user: { id: OTHER_ID } }
    adminGateResult = new Response(
      JSON.stringify({ error: 'not_found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
    // requireAdminApi returns 404 for authed non-admins; the task brief says
    // "403" but the actual project pattern returns 404 to avoid leaking
    // admin route existence. We assert the project's actual behaviour.
    currentFakeClient = makeRouteClient()

    const { POST } = await import('@/app/api/admin/orgs/ban/route')
    const res = await POST(
      makeRequest('http://test/api/admin/orgs/ban', {
        org_id: ORG_ID,
        reason: 'spam',
      }),
    )
    expect([403, 404]).toContain(res.status)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 400 already_banned when org is already banned', async () => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeRouteClient({
      org: { id: ORG_ID, slug: 'acme', banned_at: '2024-01-01T00:00:00Z' },
    })

    const { POST } = await import('@/app/api/admin/orgs/ban/route')
    const res = await POST(
      makeRequest('http://test/api/admin/orgs/ban', {
        org_id: ORG_ID,
        reason: 'spam',
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('already_banned')
  })

  it('returns 404 when org does not exist', async () => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeRouteClient({ org: null })

    const { POST } = await import('@/app/api/admin/orgs/ban/route')
    const res = await POST(
      makeRequest('http://test/api/admin/orgs/ban', {
        org_id: ORG_ID,
        reason: 'spam',
      }),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('org_not_found')
  })

  it('happy path: updates orgs row and writes mod_action row', async () => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeRouteClient({
      org: { id: ORG_ID, slug: 'acme', banned_at: null },
    })

    const { POST } = await import('@/app/api/admin/orgs/ban/route')
    const res = await POST(
      makeRequest('http://test/api/admin/orgs/ban', {
        org_id: ORG_ID,
        reason: 'violates ToS',
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(ORG_ID)
    expect(body.slug).toBe('acme')
    expect(typeof body.banned_at).toBe('string')

    const orgUpdate = capturedOps.find(
      (o) => o.table === 'orgs' && o.op === 'update',
    )
    expect(orgUpdate).toBeTruthy()
    const payload = orgUpdate!.payload as {
      banned_at: string
      banned_reason: string
      banned_by: string
    }
    expect(payload.banned_at).toBeTruthy()
    expect(payload.banned_reason).toBe('violates ToS')
    expect(payload.banned_by).toBe(ADMIN_ID)

    const audit = capturedOps.find(
      (o) => o.table === 'mod_actions' && o.op === 'insert',
    )
    expect(audit).toBeTruthy()
    expect(audit!.payload).toMatchObject({
      mod_user_id: ADMIN_ID,
      action: 'ban_org',
      target_type: 'org',
      target_id: ORG_ID,
      reason: 'violates ToS',
      metadata: { slug: 'acme' },
    })
  })
})

// ===========================================================================
// POST /api/admin/orgs/unban
// ===========================================================================
describe('POST /api/admin/orgs/unban', () => {
  it('returns 400 not_banned when org is not banned', async () => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeRouteClient({
      org: { id: ORG_ID, slug: 'acme', banned_at: null },
    })

    const { POST } = await import('@/app/api/admin/orgs/unban/route')
    const res = await POST(
      makeRequest('http://test/api/admin/orgs/unban', { org_id: ORG_ID }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'not_banned' })
  })

  it('happy path: clears ban fields and writes mod_action row', async () => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeRouteClient({
      org: { id: ORG_ID, slug: 'acme', banned_at: '2024-01-01T00:00:00Z' },
    })

    const { POST } = await import('@/app/api/admin/orgs/unban/route')
    const res = await POST(
      makeRequest('http://test/api/admin/orgs/unban', { org_id: ORG_ID }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: ORG_ID, slug: 'acme' })

    const orgUpdate = capturedOps.find(
      (o) => o.table === 'orgs' && o.op === 'update',
    )
    expect(orgUpdate).toBeTruthy()
    expect(orgUpdate!.payload).toEqual({
      banned_at: null,
      banned_reason: null,
      banned_by: null,
    })

    const audit = capturedOps.find(
      (o) => o.table === 'mod_actions' && o.op === 'insert',
    )
    expect(audit).toBeTruthy()
    expect(audit!.payload).toMatchObject({
      mod_user_id: ADMIN_ID,
      action: 'unban_org',
      target_type: 'org',
      target_id: ORG_ID,
      reason: null,
      metadata: { slug: 'acme' },
    })
  })
})

// ===========================================================================
// lib/admin/search-orgs.ts — q + status filtering
// ===========================================================================

// A separate, more focused fake client for searchOrgs() that captures the
// query method calls so we can assert filter semantics.
interface SearchClientCapture {
  orFilter: string | null
  bannedFilter: 'isNull' | 'notNull' | null
  deletedFilter: 'isNull' | 'notNull' | null
}

function makeSearchClient(
  rows: Array<{
    id: string
    slug: string
    display_name: string
    created_at: string
    created_by_user_id: string
    banned_at: string | null
    banned_reason: string | null
    deleted_at: string | null
  }>,
  capture: SearchClientCapture,
) {
  const orgsChain: Record<string, ReturnType<typeof vi.fn>> = {}

  orgsChain.select = vi.fn(() => orgsChain)
  orgsChain.or = vi.fn((expr: string) => {
    capture.orFilter = expr
    return orgsChain
  })
  orgsChain.is = vi.fn((col: string, val: unknown) => {
    if (val === null) {
      if (col === 'banned_at') capture.bannedFilter = 'isNull'
      if (col === 'deleted_at') capture.deletedFilter = 'isNull'
    }
    return orgsChain
  })
  orgsChain.not = vi.fn((col: string, op: string, val: unknown) => {
    if (op === 'is' && val === null) {
      if (col === 'banned_at') capture.bannedFilter = 'notNull'
      if (col === 'deleted_at') capture.deletedFilter = 'notNull'
    }
    return orgsChain
  })
  orgsChain.order = vi.fn(() => orgsChain)
  // range is the terminal call — return the data.
  orgsChain.range = vi.fn(async () => ({ data: rows, error: null }))

  // org_members / posts count chains
  const countChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn(async () => ({ count: 0, error: null })),
  }
  // For the org_members chain, the terminal call is `.eq()`. We need it to
  // resolve to a count. Override to be thenable.
  const memberChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(async () => ({ count: 3, error: null })),
  }
  const postChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn(async () => ({ count: 5, error: null })),
  }

  // users batch
  const usersChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn(async () => ({
      data: [{ id: 'creator-1', username: 'alice' }],
      error: null,
    })),
  }

  void countChain // silence unused

  return {
    from: vi.fn((table: string) => {
      if (table === 'orgs') return orgsChain
      if (table === 'org_members') return memberChain
      if (table === 'posts') return postChain
      if (table === 'users') return usersChain
      throw new Error(`unexpected table: ${table}`)
    }),
  }
}

describe('searchOrgs()', () => {
  const SAMPLE_ROW = {
    id: ORG_ID,
    slug: 'acme',
    display_name: 'Acme',
    created_at: '2025-01-01T00:00:00Z',
    created_by_user_id: 'creator-1',
    banned_at: null as string | null,
    banned_reason: null as string | null,
    deleted_at: null as string | null,
  }

  it('passes ilike OR filter when q is provided', async () => {
    const capture: SearchClientCapture = {
      orFilter: null,
      bannedFilter: null,
      deletedFilter: null,
    }
    currentFakeClient = makeSearchClient([SAMPLE_ROW], capture)

    const { searchOrgs } = await import('@/lib/admin/search-orgs')
    const rows = await searchOrgs({ q: 'acme', status: 'all' })

    expect(capture.orFilter).toContain('slug.ilike.%acme%')
    expect(capture.orFilter).toContain('display_name.ilike.%acme%')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.slug).toBe('acme')
    expect(rows[0]?.created_by_username).toBe('alice')
    expect(rows[0]?.member_count).toBe(3)
    expect(rows[0]?.post_count).toBe(5)
  })

  it('status=active filters banned_at IS NULL and deleted_at IS NULL', async () => {
    const capture: SearchClientCapture = {
      orFilter: null,
      bannedFilter: null,
      deletedFilter: null,
    }
    currentFakeClient = makeSearchClient([SAMPLE_ROW], capture)

    const { searchOrgs } = await import('@/lib/admin/search-orgs')
    await searchOrgs({ status: 'active' })

    expect(capture.bannedFilter).toBe('isNull')
    expect(capture.deletedFilter).toBe('isNull')
  })

  it('status=banned filters banned_at IS NOT NULL', async () => {
    const capture: SearchClientCapture = {
      orFilter: null,
      bannedFilter: null,
      deletedFilter: null,
    }
    currentFakeClient = makeSearchClient(
      [{ ...SAMPLE_ROW, banned_at: '2025-02-01T00:00:00Z' }],
      capture,
    )

    const { searchOrgs } = await import('@/lib/admin/search-orgs')
    await searchOrgs({ status: 'banned' })

    expect(capture.bannedFilter).toBe('notNull')
    expect(capture.deletedFilter).toBe(null)
  })

  it('status=deleted filters deleted_at IS NOT NULL', async () => {
    const capture: SearchClientCapture = {
      orFilter: null,
      bannedFilter: null,
      deletedFilter: null,
    }
    currentFakeClient = makeSearchClient(
      [{ ...SAMPLE_ROW, deleted_at: '2025-02-01T00:00:00Z' }],
      capture,
    )

    const { searchOrgs } = await import('@/lib/admin/search-orgs')
    await searchOrgs({ status: 'deleted' })

    expect(capture.deletedFilter).toBe('notNull')
    expect(capture.bannedFilter).toBe(null)
  })

  it('status=all applies no banned/deleted filters', async () => {
    const capture: SearchClientCapture = {
      orFilter: null,
      bannedFilter: null,
      deletedFilter: null,
    }
    currentFakeClient = makeSearchClient([SAMPLE_ROW], capture)

    const { searchOrgs } = await import('@/lib/admin/search-orgs')
    await searchOrgs({ status: 'all' })

    expect(capture.bannedFilter).toBe(null)
    expect(capture.deletedFilter).toBe(null)
    expect(capture.orFilter).toBe(null)
  })
})
