/**
 * Unit tests for the NextAuth `session` callback in lib/auth.ts.
 *
 * The callback:
 *   1. Looks up `public.users.username` and surfaces it on
 *      `session.user.username` so the topbar can link to the profile.
 *   2. Self-heals a missing `public.users` row by invoking
 *      ensurePublicUser when the lookup returns nothing.
 *   3. Falls back gracefully (no username, no throw) when Supabase
 *      misbehaves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session, User } from 'next-auth'
import type { AdapterUser } from 'next-auth/adapters'

// ---------------------------------------------------------------------------
// Mocks (declared before the import that triggers them)
// ---------------------------------------------------------------------------

const ensurePublicUser = vi.fn()
const createAdminSupabaseClient = vi.fn()

vi.mock('@/lib/users/ensure-public-user', () => ({
  ensurePublicUser: (...args: unknown[]) => ensurePublicUser(...args),
}))

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
    ensurePublicUser.mockReset()
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
    // Username was already there, so no self-heal call.
    expect(ensurePublicUser).not.toHaveBeenCalled()
    expect(supa.from).toHaveBeenCalledWith('users')
  })

  it('self-heals via ensurePublicUser when the public.users row is missing', async () => {
    const supa = mockSupabaseUsersLookup(null)
    createAdminSupabaseClient.mockReturnValue(supa)
    ensurePublicUser.mockResolvedValue('healed-name')

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    expect(ensurePublicUser).toHaveBeenCalledTimes(1)
    expect(ensurePublicUser).toHaveBeenCalledWith(supa, 'user-1')
    expect(out.user?.username).toBe('healed-name')
  })

  it('leaves username undefined when even ensurePublicUser fails', async () => {
    const supa = mockSupabaseUsersLookup(null)
    createAdminSupabaseClient.mockReturnValue(supa)
    ensurePublicUser.mockResolvedValue(null)

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    expect(ensurePublicUser).toHaveBeenCalledTimes(1)
    expect(out.user?.username).toBeUndefined()
    expect(out.user?.id).toBe('user-1')
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
