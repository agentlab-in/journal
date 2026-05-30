/**
 * Unit tests for lib/admin/list-audit.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

import { listAuditActions } from '@/lib/admin/list-audit'

const MOD_ID = 'aabbccdd-1234-4000-8001-000000000001'
const NOW = '2025-01-15T10:00:00.000Z'

const ACTION_ROW = {
  id: 'action-1',
  created_at: NOW,
  mod_user_id: MOD_ID,
  action: 'ban_user',
  target_type: 'user',
  target_id: 'aabbccdd-1234-4000-8001-000000000099',
  reason: 'spamming',
}

function makeFakeClient(opts: {
  actionRows?: unknown[]
  modUsers?: unknown[]
} = {}) {
  const {
    actionRows = [],
    modUsers = [{ id: MOD_ID, username: 'admin' }],
  } = opts

  const modActionsChain = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
  }
  modActionsChain.limit = vi.fn().mockImplementation(async () => ({ data: actionRows, error: null }))

  const usersChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockImplementation(async () => ({ data: modUsers, error: null })),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'mod_actions') return modActionsChain
      if (table === 'users') return usersChain
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn(async () => ({ data: [], error: null })),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      }
    }),
  }
}

describe('listAuditActions()', () => {
  beforeEach(() => {
    currentFakeClient = {}
  })

  it('returns empty rows when no mod actions exist', async () => {
    currentFakeClient = makeFakeClient({ actionRows: [] })

    const result = await listAuditActions()

    expect(result.rows).toEqual([])
    expect(result.nextCursor).toBeNull()
  })

  it('returns rows with mod username resolved', async () => {
    currentFakeClient = makeFakeClient({ actionRows: [ACTION_ROW] })

    const result = await listAuditActions()

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].action).toBe('ban_user')
    expect(result.rows[0].mod_username).toBe('admin')
    expect(result.rows[0].reason).toBe('spamming')
  })

  it('applies actor filter when provided', async () => {
    // Chain must be awaitable (Promise-like) so `await query` works after chaining
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    }

    currentFakeClient = {
      from: vi.fn((table: string) => {
        if (table === 'mod_actions') return chain
        return { select: vi.fn().mockReturnThis(), in: vi.fn(async () => ({ data: [], error: null })) }
      }),
    }

    await listAuditActions({ actor: MOD_ID })

    expect(chain.eq).toHaveBeenCalledWith('mod_user_id', MOD_ID)
  })

  it('applies target_type filter when provided', async () => {
    // Chain must be awaitable (Promise-like) so `await query` works after chaining
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    }

    currentFakeClient = {
      from: vi.fn((table: string) => {
        if (table === 'mod_actions') return chain
        return { select: vi.fn().mockReturnThis(), in: vi.fn(async () => ({ data: [], error: null })) }
      }),
    }

    await listAuditActions({ target_type: 'post' })

    expect(chain.eq).toHaveBeenCalledWith('target_type', 'post')
  })

  it('returns nextCursor when more rows than limit', async () => {
    const makeRow = (i: number) => ({
      ...ACTION_ROW,
      id: `action-${i}`,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    })

    const rows = Array.from({ length: 51 }, (_, i) => makeRow(i))
    currentFakeClient = makeFakeClient({ actionRows: rows })

    const result = await listAuditActions({}, 50)

    expect(result.rows).toHaveLength(50)
    expect(result.nextCursor).not.toBeNull()
  })

  it('applies cursor (lt filter) when cursor is provided', async () => {
    const cursorTs = '2025-01-10T00:00:00.000Z'
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
    }
    chain.limit = vi.fn().mockReturnValue(chain)
    chain.lt = vi.fn().mockImplementation(async () => ({ data: [], error: null }))

    currentFakeClient = {
      from: vi.fn((table: string) => {
        if (table === 'mod_actions') return chain
        return { select: vi.fn().mockReturnThis(), in: vi.fn(async () => ({ data: [], error: null })) }
      }),
    }

    await listAuditActions({ cursor: cursorTs })

    expect(chain.lt).toHaveBeenCalledWith('created_at', cursorTs)
  })
})
