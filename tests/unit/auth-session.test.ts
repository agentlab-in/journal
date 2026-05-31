/**
 * Unit tests for the NextAuth `session` callback in lib/auth.ts.
 *
 * The callback:
 *   1. Looks up `public.users.username` (plus display_name + avatar_url)
 *      and surfaces them on `session.user.username` / `.name` / `.image`
 *      so the topbar can link to the profile and render the correct
 *      name + avatar. The display_name + avatar_url override dodges a
 *      @next-auth/supabase-adapter@0.2.1 bug where its `format()` helper
 *      coerces date-parseable strings (e.g. short GitHub logins like
 *      "317") into Date objects, which then ISO-serialize into the
 *      session and surface as garbled timestamps in the UI.
 *   2. Self-heals a missing `public.users` row by invoking
 *      ensurePublicUser when the lookup returns nothing — and then
 *      re-reads display_name + avatar_url so the first render after
 *      self-heal already has the correct name.
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

type PublicUserRow = {
  username: string
  display_name: string | null
  avatar_url: string | null
}

/**
 * Build a chainable mock Supabase client where the terminal
 * `.maybeSingle()` resolves with the given row on each call.
 *
 * Pass an array to script successive `.maybeSingle()` resolutions
 * (used to model the post-self-heal re-read).
 */
function mockSupabaseUsersLookup(
  rowOrRows: PublicUserRow | null | Array<PublicUserRow | null>,
) {
  const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
  const maybeSingle = vi.fn()
  for (const r of rows) {
    maybeSingle.mockResolvedValueOnce({ data: r, error: null })
  }
  // Fallback for any extra calls: behave like the last scripted row.
  maybeSingle.mockResolvedValue({ data: rows[rows.length - 1], error: null })
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
    const supa = mockSupabaseUsersLookup({
      username: 'alice',
      display_name: 'Alice Anderson',
      avatar_url: 'https://example.com/a.png',
    })
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

  it('overrides session.user.name with display_name from public.users (dodges adapter format() bug)', async () => {
    const supa = mockSupabaseUsersLookup({
      username: '317',
      display_name: '317',
      avatar_url: null,
    })
    createAdminSupabaseClient.mockReturnValue(supa)

    // Simulate the adapter's format() bug: it coerced the date-parseable
    // login "317" into a Date that NextAuth then ISO-serialized.
    const corruptedName = '0317-12-31T18:06:32.000Z'
    const out = await callSession({
      session: {
        ...BASE_SESSION,
        user: { ...BASE_SESSION.user!, name: corruptedName },
      },
      user: BASE_USER,
    })

    expect(out.user?.name).toBe('317')
    expect(out.user?.username).toBe('317')
  })

  it('overrides session.user.image with avatar_url when non-null', async () => {
    const supa = mockSupabaseUsersLookup({
      username: 'alice',
      display_name: 'Alice',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    })
    createAdminSupabaseClient.mockReturnValue(supa)

    const out = await callSession({
      session: {
        ...BASE_SESSION,
        user: { ...BASE_SESSION.user!, image: 'https://stale.example/old.png' },
      },
      user: BASE_USER,
    })

    expect(out.user?.image).toBe('https://avatars.githubusercontent.com/u/1?v=4')
  })

  it('leaves session.user.image alone when avatar_url is null', async () => {
    const supa = mockSupabaseUsersLookup({
      username: 'alice',
      display_name: 'Alice',
      avatar_url: null,
    })
    createAdminSupabaseClient.mockReturnValue(supa)

    const incoming = 'https://incoming.example/a.png'
    const out = await callSession({
      session: {
        ...BASE_SESSION,
        user: { ...BASE_SESSION.user!, image: incoming },
      },
      user: BASE_USER,
    })

    expect(out.user?.image).toBe(incoming)
  })

  it('self-heals via ensurePublicUser when the public.users row is missing', async () => {
    // First lookup misses, ensurePublicUser heals, second lookup hits.
    const supa = mockSupabaseUsersLookup([
      null,
      { username: 'healed-name', display_name: 'Healed Name', avatar_url: null },
    ])
    createAdminSupabaseClient.mockReturnValue(supa)
    ensurePublicUser.mockResolvedValue('healed-name')

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    expect(ensurePublicUser).toHaveBeenCalledTimes(1)
    expect(ensurePublicUser).toHaveBeenCalledWith(supa, 'user-1')
    expect(out.user?.username).toBe('healed-name')
    // Post-self-heal re-read populates name from display_name.
    expect(out.user?.name).toBe('Healed Name')
  })

  it('populates name + image from the post-self-heal re-read when avatar_url is non-null', async () => {
    const supa = mockSupabaseUsersLookup([
      null,
      {
        username: 'healed',
        display_name: 'Healed Person',
        avatar_url: 'https://avatars.githubusercontent.com/u/42?v=4',
      },
    ])
    createAdminSupabaseClient.mockReturnValue(supa)
    ensurePublicUser.mockResolvedValue('healed')

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    expect(out.user?.username).toBe('healed')
    expect(out.user?.name).toBe('Healed Person')
    expect(out.user?.image).toBe('https://avatars.githubusercontent.com/u/42?v=4')
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

  it('uses ensurePublicUser login fallback as username when post-heal re-read also returns null (first-render race)', async () => {
    // Simulates the timing window reported by the reviewer:
    // - Initial public.users lookup misses (row not committed yet)
    // - ensurePublicUser runs its upsert + retry but the DB read still returns null
    //   (extreme read-after-write lag), so ensurePublicUser returns the login string directly
    // - The session callback MUST still surface username so the topbar renders the profile link
    const supa = mockSupabaseUsersLookup([null, null])
    createAdminSupabaseClient.mockReturnValue(supa)
    // ensurePublicUser returns the login fallback (non-null string)
    ensurePublicUser.mockResolvedValue('alice')

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    expect(ensurePublicUser).toHaveBeenCalledTimes(1)
    // username must be present even when the re-read returns null
    expect(out.user?.username).toBe('alice')
    expect(out.user?.id).toBe('user-1')
  })
})
