import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
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
// Helpers
// ---------------------------------------------------------------------------

// Valid RFC 4122 UUIDs — version nibble 4, variant bits 8
const REPORTER_ID = 'aabbccdd-1234-4000-8001-000000000001'
const TARGET_POST_ID = 'aabbccdd-1234-4000-8001-000000000002'
const TARGET_COMMENT_ID = 'aabbccdd-1234-4000-8001-000000000003'
const TARGET_USER_ID = 'aabbccdd-1234-4000-8001-000000000004'
const POST_AUTHOR_ID = 'aabbccdd-1234-4000-8001-000000000005'
const COMMENT_AUTHOR_ID = 'aabbccdd-1234-4000-8001-000000000006'

const VALID_POST_ROW = { id: TARGET_POST_ID, author_id: POST_AUTHOR_ID }
const VALID_COMMENT_ROW = { id: TARGET_COMMENT_ID, author_id: COMMENT_AUTHOR_ID }
const VALID_USER_ROW = { id: TARGET_USER_ID }
const VALID_REPORT_ROW = { id: 'aabbccdd-1234-4000-8001-000000000099' }

/**
 * Build a chainable query mock that resolves via maybeSingle/single.
 */
function makeQueryChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
  }
}

/**
 * Build a fake Supabase client for POST /api/reports tests.
 *
 * opts.postRow    — what the `posts` table returns for .maybeSingle()
 * opts.commentRow — what the `comments` table returns for .maybeSingle()
 * opts.userRow    — what the `users` table returns for .maybeSingle()
 * opts.dupRow     — what the `reports` table returns for the dedup query
 * opts.insertResult — what the `reports` insert returns for .single()
 */
function makeFakeClient(opts: {
  postRow?: unknown
  commentRow?: unknown
  userRow?: unknown
  dupRow?: unknown
  insertResult?: { data: unknown; error: unknown }
} = {}) {
  const {
    postRow = VALID_POST_ROW,
    commentRow = VALID_COMMENT_ROW,
    userRow = VALID_USER_ROW,
    dupRow = null,
    insertResult = { data: VALID_REPORT_ROW, error: null },
  } = opts

  // Track how many times `from('reports')` has been called.
  // Call 1 = dedup select; Call 2 = insert.
  let reportsCallCount = 0

  return {
    from: vi.fn((table: string) => {
      if (table === 'posts') {
        return makeQueryChain({ data: postRow, error: postRow ? null : { message: 'not found' } })
      }
      if (table === 'comments') {
        return makeQueryChain({
          data: commentRow,
          error: commentRow ? null : { message: 'not found' },
        })
      }
      if (table === 'users') {
        return makeQueryChain({
          data: userRow,
          error: userRow ? null : { message: 'not found' },
        })
      }
      if (table === 'reports') {
        reportsCallCount++
        const callNo = reportsCallCount
        // First call: dedup select chain — returns via maybeSingle
        // Second call: insert chain — returns via single
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () =>
            callNo === 1
              ? { data: dupRow, error: null }
              : { data: null, error: null },
          ),
          single: vi.fn(async () =>
            callNo === 2 ? insertResult : { data: null, error: { message: 'wrong call' } },
          ),
        }
        return chain
      }
      // Default: no-op
      return makeQueryChain({ data: null, error: { message: 'not found' } })
    }),
  }
}

function makeRequest(body: unknown) {
  return new Request('http://test/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/reports — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    currentFakeClient = makeFakeClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'post', target_id: TARGET_POST_ID, reason: 'spam' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })
})

describe('POST /api/reports — 400 invalid_body', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: REPORTER_ID } }
    currentFakeClient = makeFakeClient()
  })

  it('returns 400 when target_type is missing', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_id: TARGET_POST_ID, reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
    expect(Array.isArray(body.issues)).toBe(true)
  })

  it('returns 400 when target_type is invalid', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'invalid', target_id: TARGET_POST_ID, reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when target_id is not a UUID', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'post', target_id: 'not-a-uuid', reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when reason is too long (> 1000 chars)', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'post', target_id: TARGET_POST_ID, reason: 'x'.repeat(1001) }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when reason is empty string', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'post', target_id: TARGET_POST_ID, reason: '' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })
})

describe('POST /api/reports — 400 self_report', () => {
  beforeEach(() => {
    currentFakeClient = makeFakeClient()
  })

  it('returns 400 when reporting own user profile', async () => {
    sessionState.value = { user: { id: TARGET_USER_ID } }
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'user', target_id: TARGET_USER_ID, reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('self_report')
  })

  it('returns 400 when reporting own post', async () => {
    // Make the reporter the post author
    sessionState.value = { user: { id: POST_AUTHOR_ID } }
    currentFakeClient = makeFakeClient()
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'post', target_id: TARGET_POST_ID, reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('self_report')
  })

  it('returns 400 when reporting own comment', async () => {
    // Make the reporter the comment author
    sessionState.value = { user: { id: COMMENT_AUTHOR_ID } }
    currentFakeClient = makeFakeClient()
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'comment', target_id: TARGET_COMMENT_ID, reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('self_report')
  })
})

describe('POST /api/reports — 404 target_not_found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: REPORTER_ID } }
  })

  it('returns 404 when post does not exist', async () => {
    currentFakeClient = makeFakeClient({ postRow: null })
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'post', target_id: TARGET_POST_ID, reason: 'spam' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('target_not_found')
  })

  it('returns 404 when comment does not exist', async () => {
    currentFakeClient = makeFakeClient({ commentRow: null })
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'comment', target_id: TARGET_COMMENT_ID, reason: 'spam' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('target_not_found')
  })

  it('returns 404 when user does not exist', async () => {
    currentFakeClient = makeFakeClient({ userRow: null })
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'user', target_id: TARGET_USER_ID, reason: 'spam' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('target_not_found')
  })
})

describe('POST /api/reports — 400 duplicate_report', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: REPORTER_ID } }
    // dupRow is non-null, meaning an existing open report exists
    currentFakeClient = makeFakeClient({ dupRow: { id: 'existing-report-id' } })
  })

  it('returns 400 when reporter already has an open report on this target', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'post', target_id: TARGET_POST_ID, reason: 'spam' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('duplicate_report')
  })
})

describe('POST /api/reports — 201 happy path', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: REPORTER_ID } }
    currentFakeClient = makeFakeClient()
  })

  it('inserts report and returns 201 with report id', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'post', target_id: TARGET_POST_ID, reason: 'spam' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe(VALID_REPORT_ROW.id)
  })

  it('accepts target_type=comment', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'comment', target_id: TARGET_COMMENT_ID, reason: 'harassment' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe(VALID_REPORT_ROW.id)
  })

  it('accepts target_type=user when not self', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'user', target_id: TARGET_USER_ID, reason: 'spam' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe(VALID_REPORT_ROW.id)
  })

  it('accepts reason at exactly 1000 characters', async () => {
    const { POST } = await import('@/app/api/reports/route')
    const res = await POST(makeRequest({ target_type: 'post', target_id: TARGET_POST_ID, reason: 'x'.repeat(1000) }))
    expect(res.status).toBe(201)
  })
})
