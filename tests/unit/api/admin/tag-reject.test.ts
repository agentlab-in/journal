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
const ADMIN_ID = 'aabbccdd-1234-4000-8001-000000000001'
const OTHER_ID = 'aabbccdd-1234-4000-8001-000000000002'

const PENDING_TAG_ROW  = { slug: 'ai-agents', rejected_at: null }
const REJECTED_TAG_ROW = { slug: 'ai-agents', rejected_at: '2024-01-01T00:00:00.000Z' }

// ---------------------------------------------------------------------------
// Fake client builder
// ---------------------------------------------------------------------------

function makeFakeClient(opts: {
  tagRow?: unknown
  updateError?: { message: string } | null
  modActionsError?: { message: string } | null
} = {}) {
  const { tagRow = PENDING_TAG_ROW, updateError = null, modActionsError = null } = opts

  const modActionsInsertFn = vi.fn(async () => ({ error: modActionsError }))

  return {
    from: vi.fn((table: string) => {
      if (table === 'tags') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: tagRow,
            error: tagRow ? null : { message: 'not found' },
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
  return new Request('http://test/api/admin/tags/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/tags/reject — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    adminGateResult = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    currentFakeClient = makeFakeClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/admin/tags/reject/route')
    const res = await POST(makeRequest({ slug: 'ai-agents', reason: 'too generic' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })
})

describe('POST /api/admin/tags/reject — 404 non-admin', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: OTHER_ID } }
    adminGateResult = new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    currentFakeClient = makeFakeClient()
  })

  it('returns 404 when authed non-admin', async () => {
    const { POST } = await import('@/app/api/admin/tags/reject/route')
    const res = await POST(makeRequest({ slug: 'ai-agents', reason: 'too generic' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('POST /api/admin/tags/reject — 400 invalid_body', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient()
  })

  it('returns 400 when slug is missing', async () => {
    const { POST } = await import('@/app/api/admin/tags/reject/route')
    const res = await POST(makeRequest({ reason: 'too generic' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when reason is missing', async () => {
    const { POST } = await import('@/app/api/admin/tags/reject/route')
    const res = await POST(makeRequest({ slug: 'ai-agents' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when reason exceeds 1000 chars', async () => {
    const { POST } = await import('@/app/api/admin/tags/reject/route')
    const res = await POST(makeRequest({ slug: 'ai-agents', reason: 'x'.repeat(1001) }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })
})

describe('POST /api/admin/tags/reject — 404 tag_not_found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient({ tagRow: null })
  })

  it('returns 404 when tag does not exist', async () => {
    const { POST } = await import('@/app/api/admin/tags/reject/route')
    const res = await POST(makeRequest({ slug: 'nonexistent-tag', reason: 'too generic' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('tag_not_found')
  })
})

describe('POST /api/admin/tags/reject — 400 already_rejected', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
    currentFakeClient = makeFakeClient({ tagRow: REJECTED_TAG_ROW })
  })

  it('returns 400 when tag is already rejected', async () => {
    const { POST } = await import('@/app/api/admin/tags/reject/route')
    const res = await POST(makeRequest({ slug: 'ai-agents', reason: 'too generic' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('already_rejected')
  })
})

describe('POST /api/admin/tags/reject — 200 happy path', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: ADMIN_ID } }
    adminGateResult = null
  })

  it('soft-rejects tag, writes mod_actions with reason, returns 200', async () => {
    const client = makeFakeClient()
    currentFakeClient = client
    const { POST } = await import('@/app/api/admin/tags/reject/route')
    const res = await POST(makeRequest({ slug: 'ai-agents', reason: 'too generic' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modCall = (client.modActionsInsertFn.mock.calls as any[][])[0]![0]
    expect(modCall.action).toBe('reject_tag')
    expect(modCall.target_type).toBe('tag')
    expect(modCall.target_id).toBe('ai-agents')
    expect(modCall.reason).toBe('too generic')
  })
})
