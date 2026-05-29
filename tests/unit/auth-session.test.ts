/**
 * Unit tests for the NextAuth `session` callback in lib/auth.ts.
 *
 * The callback now looks up `public.users.username` and surfaces it on
 * `session.user.username` so the topbar can link to the user's profile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session, User } from 'next-auth'
import type { AdapterUser } from 'next-auth/adapters'

// ---------------------------------------------------------------------------
// Mocks (declared before the import that triggers them)
// ---------------------------------------------------------------------------

const createAdminSupabaseClient = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: (...args: unknown[]) => createAdminSupabaseClient(...args),
}))

import { authOptions } from '@/lib/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a chainable mock Supabase client where the terminal
 * `.maybeSingle()` resolves with the given row.
 */
function mockSupabaseUsersLookup(row: { username: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { from, _maybeSingle: maybeSingle, _eq: eq, _select: select }
}

const BASE_SESSION: Session = {
  user: { id: '', name: 'Alice', email: 'alice@example.com' },
  expires: '2099-12-31T23:59:59.000Z',
}

const BASE_USER: AdapterUser = {
  id: 'user-1',
  email: 'alice@example.com',
  emailVerified: null,
}

async function callSession(args: {
  session: Session
  user: User | AdapterUser
}): Promise<Session> {
  const cb = authOptions.callbacks?.session
  if (!cb) throw new Error('session callback missing')
  // The token/newSession/trigger args are required by the type but unused
  // for database sessions — pass safe stubs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await cb({ ...args, token: {} as any, newSession: undefined, trigger: 'update' } as any)
  return out as Session
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authOptions.callbacks.session', () => {
  beforeEach(() => {
    createAdminSupabaseClient.mockReset()
  })

  it('attaches user.id and looked-up username when the public.users row exists', async () => {
    const supa = mockSupabaseUsersLookup({ username: 'alice' })
    createAdminSupabaseClient.mockReturnValue(supa)

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    expect(out.user?.id).toBe('user-1')
    expect(out.user?.username).toBe('alice')
    expect(supa.from).toHaveBeenCalledWith('users')
  })

  it('leaves username undefined when the public.users row is missing', async () => {
    const supa = mockSupabaseUsersLookup(null)
    createAdminSupabaseClient.mockReturnValue(supa)

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    expect(out.user?.id).toBe('user-1')
    expect(out.user?.username).toBeUndefined()
  })

  it('does not throw when Supabase throws — returns the session without username', async () => {
    createAdminSupabaseClient.mockImplementation(() => {
      throw new Error('boom')
    })

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    expect(out.user?.id).toBe('user-1')
    expect(out.user?.username).toBeUndefined()
  })
})
