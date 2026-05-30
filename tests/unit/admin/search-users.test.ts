/**
 * Unit tests for lib/admin/search-users.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

import { searchUsers } from '@/lib/admin/search-users'

const USER_ID = 'aabbccdd-1234-4000-8001-000000000001'
const MOD_ID = 'aabbccdd-1234-4000-8001-000000000002'
const NOW = '2025-01-15T10:00:00.000Z'

const VALID_USER_ROW = {
  id: USER_ID,
  username: 'testuser',
  display_name: 'Test User',
  banned_at: null,
  banned_reason: null,
  created_at: NOW,
}

const VALID_MOD_ACTION = {
  id: 'action-1',
  created_at: NOW,
  action: 'ban_user',
  target_type: 'user',
  target_id: USER_ID,
  reason: 'spam',
  mod_user_id: MOD_ID,
}

function makeFakeClient(opts: {
  userRows?: unknown[]
  modActions?: unknown[]
  modUsers?: unknown[]
} = {}) {
  const {
    userRows = [VALID_USER_ROW],
    modActions = [],
    modUsers = [{ id: MOD_ID, username: 'admin' }],
  } = opts

  let usersCallCount = 0

  const usersChain = {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  }

  // Primary user query (ilike): resolves at limit()
  usersChain.limit = vi.fn().mockImplementation(async () => ({ data: userRows, error: null }))
  // Mod user batch lookup (in): resolves at in()
  usersChain.in = vi.fn().mockImplementation(async () => ({ data: modUsers, error: null }))

  const modActionsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(async () => ({ data: modActions, error: null })),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        usersCallCount++
        if (usersCallCount === 1) {
          // Primary search query
          return usersChain
        }
        // Mod user resolution query (second users call)
        return { select: vi.fn().mockReturnThis(), in: vi.fn(async () => ({ data: modUsers, error: null })) }
      }
      if (table === 'mod_actions') {
        return modActionsChain
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      }
    }),
  }
}

describe('searchUsers()', () => {
  beforeEach(() => {
    currentFakeClient = {}
  })

  it('returns empty array when no users match', async () => {
    currentFakeClient = makeFakeClient({ userRows: [] })

    const result = await searchUsers({ q: 'nonexistent' })

    expect(result).toEqual([])
  })

  it('uses ILIKE search on username', async () => {
    const usersChain = {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(async () => ({ data: [VALID_USER_ROW], error: null })),
      in: vi.fn(async () => ({ data: [], error: null })),
    }

    currentFakeClient = {
      from: vi.fn((table: string) => {
        if (table === 'users') return usersChain
        if (table === 'mod_actions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn(async () => ({ data: [], error: null })),
          }
        }
        return {}
      }),
    }

    await searchUsers({ q: 'test' })

    expect(usersChain.ilike).toHaveBeenCalledWith('username', '%test%')
  })

  it('returns user rows with correct shape', async () => {
    currentFakeClient = makeFakeClient()

    const result = await searchUsers({ q: 'testuser' })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(USER_ID)
    expect(result[0].username).toBe('testuser')
    expect(result[0].banned_at).toBeNull()
    expect(result[0].recent_mod_actions).toEqual([])
  })

  it('attaches recent mod actions to matching users', async () => {
    currentFakeClient = makeFakeClient({ modActions: [VALID_MOD_ACTION] })

    const result = await searchUsers({ q: 'testuser' })

    expect(result[0].recent_mod_actions).toHaveLength(1)
    expect(result[0].recent_mod_actions[0].action).toBe('ban_user')
    expect(result[0].recent_mod_actions[0].mod_username).toBe('admin')
  })

  it('returns banned user with banned_at set', async () => {
    const bannedRow = {
      ...VALID_USER_ROW,
      banned_at: NOW,
      banned_reason: 'spamming',
    }
    currentFakeClient = makeFakeClient({ userRows: [bannedRow] })

    const result = await searchUsers({ q: 'testuser' })

    expect(result[0].banned_at).toBe(NOW)
    expect(result[0].banned_reason).toBe('spamming')
  })
})
