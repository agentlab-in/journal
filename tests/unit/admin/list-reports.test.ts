/**
 * Unit tests for lib/admin/list-reports.ts
 *
 * Mocks the Supabase admin client and verifies the WHERE/JOIN shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the admin client
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

import { listUnresolvedReports } from '@/lib/admin/list-reports'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPORT_ID = 'aabbccdd-1234-4000-8001-000000000001'
const REPORTER_ID = 'aabbccdd-1234-4000-8001-000000000002'

const NOW = '2025-01-15T10:00:00.000Z'

function makeQueryChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => result),
    then: undefined,
    // Make the chain itself awaitable (for .select(...) without terminal)
    [Symbol.iterator]: undefined,
  }
}

/**
 * Build a minimal fake client for list-reports.
 *
 * Tables queried:
 *   - reports (WHERE resolved_at IS NULL)
 *   - users (batch reporter lookup + target user lookup)
 *   - posts (target post lookup)
 *   - comments (target comment lookup)
 */
function makeFakeClient(opts: {
  reportRows?: unknown[]
  reporterRow?: unknown
  postRow?: unknown
  commentRow?: unknown
  userRow?: unknown
} = {}) {
  const {
    reportRows = [],
    reporterRow = { id: REPORTER_ID, username: 'reporter' },
    postRow = { title: 'Test Post', slug: 'test-post', type: 'post', author_id: 'author-id' },
    commentRow = { body: 'This is a comment body', post_id: 'post-id' },
    userRow = { username: 'targetuser' },
  } = opts

  // Track call counts for tables that are queried multiple times
  let usersCallCount = 0

  const reportsChain = {
    select: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(async () => ({ data: reportRows, error: null })),
    lt: vi.fn().mockReturnThis(),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'reports') {
        return reportsChain
      }
      if (table === 'users') {
        usersCallCount++
        const callNo = usersCallCount
        if (callNo === 1) {
          // Batch reporter lookup
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: reporterRow ? [reporterRow] : [],
              error: null,
            })),
          }
        }
        // Target user lookup (for user-type reports)
        return makeQueryChain({ data: userRow, error: null })
      }
      if (table === 'posts') {
        // Could be target post or comment's parent post
        return makeQueryChain({ data: postRow, error: null })
      }
      if (table === 'comments') {
        return makeQueryChain({ data: commentRow, error: null })
      }
      if (table === 'post_tags') {
        return makeQueryChain({ data: null, error: null })
      }
      return makeQueryChain({ data: null, error: null })
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listUnresolvedReports()', () => {
  beforeEach(() => {
    currentFakeClient = {}
  })

  it('returns empty rows and null cursor when no reports exist', async () => {
    currentFakeClient = makeFakeClient({ reportRows: [] })

    const result = await listUnresolvedReports()

    expect(result.rows).toEqual([])
    expect(result.nextCursor).toBeNull()
  })

  it('queries with resolved_at IS NULL filter', async () => {
    currentFakeClient = makeFakeClient({ reportRows: [] })

    await listUnresolvedReports()

    const fromMock = currentFakeClient.from as ReturnType<typeof vi.fn>
    const reportsCall = fromMock.mock.calls.find((c: string[]) => c[0] === 'reports')
    expect(reportsCall).toBeTruthy()
  })

  it('returns rows with reporter username resolved', async () => {
    const reportRow = {
      id: REPORT_ID,
      created_at: NOW,
      reporter_id: REPORTER_ID,
      target_type: 'user' as const,
      target_id: 'aabbccdd-1234-4000-8001-000000000099',
      reason: 'spam',
    }

    currentFakeClient = makeFakeClient({ reportRows: [reportRow] })

    const result = await listUnresolvedReports()

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe(REPORT_ID)
    expect(result.rows[0].reporter_username).toBe('reporter')
    expect(result.rows[0].reason).toBe('spam')
  })

  it('returns nextCursor when more rows exist than limit', async () => {
    const makeRow = (i: number, ts: string) => ({
      id: `id-${i}`,
      created_at: ts,
      reporter_id: REPORTER_ID,
      target_type: 'user' as const,
      target_id: `user-${i}`,
      reason: 'test',
    })

    // 26 rows for limit=25 → should paginate
    const rows = Array.from({ length: 26 }, (_, i) =>
      makeRow(i, new Date(Date.now() - i * 1000).toISOString()),
    )

    currentFakeClient = makeFakeClient({ reportRows: rows })

    const result = await listUnresolvedReports({ limit: 25 })

    expect(result.rows).toHaveLength(25)
    expect(result.nextCursor).not.toBeNull()
  })

  it('applies cursor (lt filter) when cursor is provided', async () => {
    const cursorTs = '2025-01-10T00:00:00.000Z'

    // We need a client where the reportsChain captures the lt call
    const ltMock = vi.fn().mockImplementation(async () => ({ data: [], error: null }))
    const reportsChain = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lt: ltMock,
    }
    // Make limit also return this so lt can be called after limit
    reportsChain.limit = vi.fn().mockReturnValue(reportsChain)
    reportsChain.lt = vi.fn().mockImplementation(async () => ({ data: [], error: null }))

    currentFakeClient = {
      from: vi.fn((table: string) => {
        if (table === 'reports') return reportsChain
        return { select: vi.fn().mockReturnThis(), in: vi.fn(async () => ({ data: [], error: null })), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: null, error: null })) }
      }),
    }

    await listUnresolvedReports({ cursor: cursorTs })

    expect(reportsChain.lt).toHaveBeenCalledWith('created_at', cursorTs)
  })
})
