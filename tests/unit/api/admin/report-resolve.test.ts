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
const OTHER_ID  = 'aabbccdd-1234-4000-8001-000000000002'
const REPORT_ID = 'aabbccdd-1234-4000-8001-000000000010'
const POST_ID   = 'aabbccdd-1234-4000-8001-000000000020'

const OPEN_REPORT_ROW = {
  id: REPORT_ID,
  resolved_at: null,
  target_type: 'post',
  target_id: POST_ID,
}
const RESOLVED_REPORT_ROW = {
  id: REPORT_ID,
  resolved_at: '2024-01-01T00:00:00.000Z',
  target_type: 'post',
  target_id: POST_ID,
}

// ---------------------------------------------------------------------------
// Fake client builder
// ---------------------------------------------------------------------------

function makeFakeClient(opts: {
  reportRow?: unknown
  updateError?: { message: string } | null
  modActionsError?: { message: string } | null
} = {}) {
  const { reportRow = OPEN_REPORT_ROW, updateError = null, modActionsError = null } = opts

  const modActionsInsertFn = vi.fn(async () => ({ error: modActionsError }))

  return {
    from: vi.fn((table: string) => {
      if (table === 'reports') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: reportRow,
            error: reportRow ? null : { message: 'not found' },
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
  return new Request(`http://test/api/admin/reports/${REPORT_ID}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: JSON.stringify(body),
  })
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/reports/[id]/resolve — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    adminGateResult = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    currentFakeClient = makeFakeClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({ resolution: 'dismissed' }), makeContext(REPORT_ID))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })
})

describe('POST /api/admin/reports/[id]/resolve — 404 non-admin', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: OTHER_ID } }
    adminGateResult = new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    currentFakeClient = makeFakeClient()
  })

  it('returns 404 when authed non-admin', async () => {
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({ resolution: 'dismissed' }), makeContext(REPORT_ID))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('POST /api/admin/reports/[id]/resolve — 400 invalid_body', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient()
  })

  it('returns 400 when resolution is missing', async () => {
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({}), makeContext(REPORT_ID))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when resolution is invalid value', async () => {
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({ resolution: 'ignored' }), makeContext(REPORT_ID))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when notes exceeds 1000 chars', async () => {
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({ resolution: 'dismissed', notes: 'x'.repeat(1001) }), makeContext(REPORT_ID))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })
})

describe('POST /api/admin/reports/[id]/resolve — 404 report_not_found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient({ reportRow: null })
  })

  it('returns 404 when report does not exist', async () => {
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({ resolution: 'dismissed' }), makeContext(REPORT_ID))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('report_not_found')
  })
})

describe('POST /api/admin/reports/[id]/resolve — 400 already_resolved', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient({ reportRow: RESOLVED_REPORT_ROW })
  })

  it('returns 400 when report is already resolved', async () => {
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({ resolution: 'dismissed' }), makeContext(REPORT_ID))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('already_resolved')
  })
})

describe('POST /api/admin/reports/[id]/resolve — 200 happy path', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
  })

  it('resolves report with actioned, writes mod_actions, returns 200', async () => {
    const client = makeFakeClient()
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({ resolution: 'actioned', notes: 'User warned' }), makeContext(REPORT_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modCall = (client.modActionsInsertFn.mock.calls as any[][])[0]![0]
    expect(modCall.action).toBe('resolve_report')
    expect(modCall.target_type).toBe('report')
    expect(modCall.target_id).toBe(REPORT_ID)
    expect(modCall.reason).toBe('User warned')
    expect(modCall.metadata.resolution).toBe('actioned')
    expect(modCall.metadata.original_target_type).toBe('post')
    expect(modCall.metadata.original_target_id).toBe(POST_ID)
  })

  it('resolves report with dismissed without notes, returns 200', async () => {
    const client = makeFakeClient()
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({ resolution: 'dismissed' }), makeContext(REPORT_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modCall = (client.modActionsInsertFn.mock.calls as any[][])[0]![0]
    expect(modCall.reason).toBeNull()
    expect(modCall.metadata.resolution).toBe('dismissed')
  })

  it('accepts notes at exactly 1000 characters', async () => {
    const client = makeFakeClient()
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/reports/[id]/resolve/route')
    const res = await POST(makeRequest({ resolution: 'dismissed', notes: 'x'.repeat(1000) }), makeContext(REPORT_ID))
    expect(res.status).toBe(200)
  })
})
