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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

  it('falls back to next_auth.users.github_login directly when ensurePublicUser returns null (deep self-heal failure)', async () => {
    // Reviewer scenario: ensurePublicUser hits one of its null-return paths
    // (e.g. next_auth.users row missing entirely, accounts lookup fails, or
    // GitHub REST 4xx). The session callback MUST still surface a username
    // — that's the user-visible bug. The new readNextAuthGithubLogin
    // fallback queries next_auth.users.github_login directly; next_auth.users
    // is guaranteed to exist by this point because the SupabaseAdapter
    // creates it before the session cookie is written.
    ensurePublicUser.mockResolvedValue(null)

    // Build a supabase mock that:
    //  - public.users select → null on first call (no row yet)
    //  - next_auth.users select github_login → { github_login: 'newuser' }
    // The session callback chooses the schema via .schema('next_auth'),
    // so we branch the chain on whether schema() was called.
    const publicMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const publicEq = vi.fn(() => ({ maybeSingle: publicMaybeSingle }))
    const publicSelect = vi.fn(() => ({ eq: publicEq }))

    const nextAuthMaybeSingle = vi.fn().mockResolvedValue({
      data: { github_login: 'newuser' },
      error: null,
    })
    const nextAuthEq = vi.fn(() => ({ maybeSingle: nextAuthMaybeSingle }))
    const nextAuthSelect = vi.fn(() => ({ eq: nextAuthEq }))
    const nextAuthFrom = vi.fn(() => ({ select: nextAuthSelect }))

    const supa = {
      from: vi.fn(() => ({ select: publicSelect })),
      schema: vi.fn(() => ({ from: nextAuthFrom })),
    }
    createAdminSupabaseClient.mockReturnValue(supa)

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    // ensurePublicUser ran (and returned null in this scenario).
    expect(ensurePublicUser).toHaveBeenCalledTimes(1)
    // The new fallback path read next_auth.users for github_login.
    expect(supa.schema).toHaveBeenCalledWith('next_auth')
    expect(nextAuthFrom).toHaveBeenCalledWith('users')
    expect(nextAuthSelect).toHaveBeenCalledWith('github_login')
    // CRITICAL: username surfaced on the FIRST session response, no reload needed.
    expect(out.user?.username).toBe('newuser')
    expect(out.user?.id).toBe('user-1')
  })

  it('leaves username undefined when ensurePublicUser returns null AND next_auth.users has no github_login', async () => {
    // Defensive case: both heal paths empty. Session must not throw and
    // must not invent a username — caller-facing code uses the absence as
    // a signal that the profile isn't yet usable.
    ensurePublicUser.mockResolvedValue(null)

    const publicMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const publicEq = vi.fn(() => ({ maybeSingle: publicMaybeSingle }))
    const publicSelect = vi.fn(() => ({ eq: publicEq }))

    const nextAuthMaybeSingle = vi.fn().mockResolvedValue({
      data: { github_login: null },
      error: null,
    })
    const nextAuthEq = vi.fn(() => ({ maybeSingle: nextAuthMaybeSingle }))
    const nextAuthSelect = vi.fn(() => ({ eq: nextAuthEq }))
    const nextAuthFrom = vi.fn(() => ({ select: nextAuthSelect }))

    const supa = {
      from: vi.fn(() => ({ select: publicSelect })),
      schema: vi.fn(() => ({ from: nextAuthFrom })),
    }
    createAdminSupabaseClient.mockReturnValue(supa)

    const out = await callSession({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
    })

    expect(out.user?.username).toBeUndefined()
    expect(out.user?.id).toBe('user-1')
  })
})

// ---------------------------------------------------------------------------
// First-call test using the REAL ensurePublicUser
//
// The tests above mock ensurePublicUser to isolate the session callback's
// branching logic. The reviewer flagged this as a gap: it can't prove that
// the end-to-end "first GET /api/auth/session after sign-in" path actually
// surfaces username when public.users starts empty. This block uses
// vi.unmock to load the real ensurePublicUser and verifies the contract
// of: public.users empty → next_auth.users has github_login → session
// callback surfaces username='newuser' on the FIRST invocation.
// ---------------------------------------------------------------------------

describe('authOptions.callbacks.session — first call with real ensurePublicUser', () => {
  beforeEach(() => {
    vi.resetModules()
    createAdminSupabaseClient.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('surfaces username on the FIRST session call when public.users is empty (real ensurePublicUser, no mock)', async () => {
    // CRITICAL: drop the ensurePublicUser mock for this test so we load
    // the real implementation. The real ensurePublicUser will:
    //   1. read public.users → null (empty)
    //   2. read next_auth.users → has github_login 'newuser'
    //   3. upsert public.users (no error)
    //   4. re-read public.users → null (still mid-race)
    //   5. wait 50 ms, retry → null
    //   6. return the login string 'newuser' as fallback
    // Then the session callback uses 'newuser' as healedUsername and
    // builds the fallback profile. The whole point: username is
    // present in result.user without ever mocking the implementation
    // under test.
    vi.doUnmock('@/lib/users/ensure-public-user')
    // Re-import authOptions so it picks up the real ensurePublicUser.
    // Note: dynamic import is awaited before the session callback so that
    // fake timers are only in-flight during the cb() call, not the import itself.
    const { authOptions: realAuthOptions } = await import('@/lib/auth')

    // Build a chainable mock that handles every call shape ensurePublicUser
    // and the session callback might make:
    //   - .from('users').select(...).eq(...).maybeSingle() → public.users
    //   - .schema('next_auth').from('users').select(...).eq(...).maybeSingle() → next_auth.users
    //   - .schema('next_auth').from('accounts').select(...).eq(...).eq(...).maybeSingle() → next_auth.accounts
    //   - .from('users').upsert(...) → public.users insert
    //   - .schema('next_auth').from('users').update(...).eq(...) → next_auth.users update
    // The script returns null for every public.users select (modeling the
    // empty state and the read-after-write window), and the github_login
    // row for next_auth.users selects.
    type Ctx = { schema: 'public' | 'next_auth'; table: string }
    const calls: Array<{ ctx: Ctx; columns: string }> = []

    function buildChain(ctx: Ctx) {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn((cols: string) => {
        calls.push({ ctx, columns: cols })
        return chain
      })
      chain.eq = vi.fn(() => chain)
      chain.maybeSingle = vi.fn(async () => {
        // public.users select: always null (no row yet, retry also null)
        if (ctx.schema === 'public' && ctx.table === 'users') {
          return { data: null, error: null }
        }
        // next_auth.users: return the github_login row
        if (ctx.schema === 'next_auth' && ctx.table === 'users') {
          return {
            data: {
              id: 'user-1',
              name: 'New User',
              image: null,
              github_login: 'newuser',
            },
            error: null,
          }
        }
        return { data: null, error: null }
      })
      chain.upsert = vi.fn(async () => ({ data: null, error: null }))
      chain.update = vi.fn(() => ({
        eq: vi.fn(async () => ({ data: null, error: null })),
      }))
      return chain
    }

    const supa = {
      from: vi.fn((table: string) => buildChain({ schema: 'public', table })),
      schema: vi.fn((schemaName: string) => ({
        from: vi.fn((table: string) =>
          buildChain({ schema: schemaName as 'next_auth', table }),
        ),
      })),
    }
    createAdminSupabaseClient.mockReturnValue(supa)

    const cb = realAuthOptions.callbacks?.session
    if (!cb) throw new Error('session callback missing on real authOptions')

    // Start the session callback without awaiting — the real ensurePublicUser
    // inside it will hit a 50 ms setTimeout; advance fake timers to fire it
    // without burning real wall-clock time, then collect the result.
    const outPromise = cb({
      session: { ...BASE_SESSION, user: { ...BASE_SESSION.user! } },
      user: BASE_USER,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      token: {} as any,
      newSession: undefined,
      trigger: 'update',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    await vi.advanceTimersByTimeAsync(60)
    const out = (await outPromise) as Session

    // The user-visible assertion: username is set on the FIRST session
    // response, so NavAuth.tsx renders the profile link without reload.
    expect(out.user?.username).toBe('newuser')
    expect(out.user?.id).toBe('user-1')
    // Sanity: at least one public.users select and one next_auth.users select happened.
    expect(calls.some((c) => c.ctx.schema === 'public' && c.ctx.table === 'users')).toBe(true)
    expect(
      calls.some((c) => c.ctx.schema === 'next_auth' && c.ctx.table === 'users'),
    ).toBe(true)
  })
})
