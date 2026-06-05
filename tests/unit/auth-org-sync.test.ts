/**
 * Unit tests for Phase 11.5 — GitHub org sync wired into events.signIn.
 *
 * Coverage:
 *   1. Happy path: events.signIn invokes syncUserGithubOrgs once with the
 *      right arguments.
 *   2. Sync failures are swallowed — events.signIn resolves cleanly so the
 *      sign-in (and the downstream signup_flags write) is never blocked.
 *   3. Missing access_token short-circuits the call.
 *   4. Non-empty deltas surface a single console.info log line.
 *
 * The pure helpers (evaluateGate / decideBanRedirect / deriveAuditColumns)
 * are covered by other tests; this file is scoped to the new wiring only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE the import that triggers them)
// ---------------------------------------------------------------------------

const syncUserGithubOrgs = vi.fn()
const ensurePublicUser = vi.fn()
const createAdminSupabaseClient = vi.fn()
const logRouteError = vi.fn()
const deriveSignupFlags = vi.fn((..._args: unknown[]) => ({}))
const fetchGithubUser = vi.fn()

vi.mock('@/lib/github', () => ({
  fetchGithubUser: (...args: unknown[]) => fetchGithubUser(...args),
}))

vi.mock('@/lib/orgs/github-sync', () => ({
  syncUserGithubOrgs: (...args: unknown[]) => syncUserGithubOrgs(...args),
}))

vi.mock('@/lib/users/ensure-public-user', () => ({
  ensurePublicUser: (...args: unknown[]) => ensurePublicUser(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: (...args: unknown[]) => createAdminSupabaseClient(...args),
}))

vi.mock('@/lib/logging/error-log', () => ({
  logRouteError: (...args: unknown[]) => logRouteError(...args),
}))

vi.mock('@/lib/auth/soft-flag', () => ({
  deriveSignupFlags: (...args: unknown[]) => deriveSignupFlags(...args),
}))

import { authOptions, buildGithubProvider, GITHUB_OAUTH_SCOPE } from '@/lib/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a chainable Supabase admin client mock that:
 *   - .schema(...).from(...).update(...).eq(...) → no-op resolved
 *   - .from(...).update(...).eq(...) → no-op resolved
 *
 * The events.signIn callback under test issues two writes (next_auth.users
 * audit-column UPDATE + public.users signup_flags UPDATE); both must
 * resolve cleanly so the sync call site is exercised.
 */
function buildAdminSupabaseStub() {
  const eq = vi.fn(async () => ({ data: null, error: null }))
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))
  const schema = vi.fn(() => ({ from }))
  return { from, schema, _update: update, _eq: eq } as Record<string, unknown>
}

const VALID_USER = { id: 'user-1', email: 'alice@example.com' }
const VALID_ACCOUNT = {
  provider: 'github',
  type: 'oauth' as const,
  providerAccountId: '12345',
  access_token: 'gh_token_abc',
}
const VALID_PROFILE = {
  login: 'alice',
  id: 12345,
  public_repos: 7,
  created_at: '2024-01-01T00:00:00Z',
  email: 'alice@example.com',
  bio: 'hi',
  followers: 10,
}

async function callEventsSignIn(overrides: {
  user?: typeof VALID_USER
  account?: Partial<typeof VALID_ACCOUNT> | null
  profile?: typeof VALID_PROFILE
} = {}): Promise<void> {
  const cb = authOptions.events?.signIn
  if (!cb) throw new Error('events.signIn callback missing')
  await cb({
    user: overrides.user ?? VALID_USER,
    account: overrides.account === null
      ? null
      : { ...VALID_ACCOUNT, ...(overrides.account ?? {}) },
    profile: overrides.profile ?? VALID_PROFILE,
    isNewUser: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

// ---------------------------------------------------------------------------
// Provider scope assertion
// ---------------------------------------------------------------------------

describe('GithubProvider authorization scope (Phase 11.5)', () => {
  it('requests read:org in addition to the defaults', () => {
    expect(GITHUB_OAUTH_SCOPE).toContain('read:org')
    expect(GITHUB_OAUTH_SCOPE).toContain('read:user')
    expect(GITHUB_OAUTH_SCOPE).toContain('user:email')
  })

  it("buildGithubProvider() sets options.authorization.params.scope to include 'read:org'", () => {
    // GithubProvider returns an object with a default `authorization` field
    // (`read:user user:email`) plus a verbatim `options` field carrying the
    // caller's overrides. NextAuth runs `parseProviders()` at request time to
    // deep-merge `options` over the defaults — at this unprocessed boundary
    // our override sits under `.options.authorization.params.scope`.
    const provider = buildGithubProvider() as {
      options?: { authorization?: { params?: { scope?: string } } | string }
    }
    const auth = provider.options?.authorization
    const scope =
      typeof auth === 'object' && auth?.params?.scope ? auth.params.scope : ''
    expect(scope).toContain('read:org')
    expect(scope).toContain('read:user')
    expect(scope).toContain('user:email')
  })
})

// ---------------------------------------------------------------------------
// events.signIn — sync wiring
// ---------------------------------------------------------------------------

describe('authOptions.events.signIn — github org sync wiring', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    syncUserGithubOrgs.mockReset()
    ensurePublicUser.mockReset()
    createAdminSupabaseClient.mockReset()
    logRouteError.mockReset()
    deriveSignupFlags.mockReset().mockReturnValue({})
    fetchGithubUser.mockReset()

    createAdminSupabaseClient.mockReturnValue(buildAdminSupabaseStub())
    ensurePublicUser.mockResolvedValue('alice')
    syncUserGithubOrgs.mockResolvedValue({ added: [], removed: [], total: 0 })
    // events.signIn now refetches /user via fetchGithubUser instead of
    // trusting the stripped `profile` arg. Provide a full GitHubUser-shaped
    // response so the gh-shape guard passes.
    fetchGithubUser.mockResolvedValue({
      login: 'alice',
      public_repos: 7,
      created_at: '2024-01-01T00:00:00Z',
      name: 'Alice',
      bio: 'hi',
      avatar_url: 'https://example.com/a.png',
      email: 'alice@example.com',
      followers: 10,
      following: 5,
    })

    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('happy path: calls syncUserGithubOrgs once with { supabase, userId, githubAccessToken }', async () => {
    await callEventsSignIn()

    expect(syncUserGithubOrgs).toHaveBeenCalledTimes(1)
    const args = syncUserGithubOrgs.mock.calls[0][0] as {
      supabase: unknown
      userId: string
      githubAccessToken: string
    }
    expect(args.supabase).toBeTruthy()
    expect(args.userId).toBe(VALID_USER.id)
    expect(args.githubAccessToken).toBe(VALID_ACCOUNT.access_token)
  })

  it('sync rejection does NOT propagate — events.signIn resolves cleanly', async () => {
    syncUserGithubOrgs.mockRejectedValue(new Error('github 503'))

    // Must not throw.
    await expect(callEventsSignIn()).resolves.toBeUndefined()

    expect(syncUserGithubOrgs).toHaveBeenCalledTimes(1)
    // signup_flags write must still have run — failure was isolated.
    expect(deriveSignupFlags).toHaveBeenCalledTimes(1)
  })

  it('skips sync when account.access_token is missing', async () => {
    await callEventsSignIn({ account: { access_token: undefined } })

    expect(syncUserGithubOrgs).not.toHaveBeenCalled()
  })

  it('logs a single console.info when the sync returns deltas', async () => {
    syncUserGithubOrgs.mockResolvedValue({
      added: ['acme'],
      removed: ['old-co'],
      total: 3,
    })

    await callEventsSignIn()

    // Filter info calls to just the org-sync delta log so unrelated info()
    // calls elsewhere in the module don't false-positive the count.
    const deltaLogs = infoSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('github org sync delta'),
    )
    expect(deltaLogs).toHaveLength(1)
    const payload = deltaLogs[0][1] as {
      userId: string
      added: string[]
      removed: string[]
      total: number
    }
    expect(payload.userId).toBe(VALID_USER.id)
    expect(payload.added).toEqual(['acme'])
    expect(payload.removed).toEqual(['old-co'])
    expect(payload.total).toBe(3)
  })

  it('does NOT log when sync returns empty deltas (no noise on no-op sign-ins)', async () => {
    syncUserGithubOrgs.mockResolvedValue({ added: [], removed: [], total: 0 })

    await callEventsSignIn()

    const deltaLogs = infoSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('github org sync delta'),
    )
    expect(deltaLogs).toHaveLength(0)
  })
})
