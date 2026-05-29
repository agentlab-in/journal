import type { NextAuthOptions, Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import GithubProvider from 'next-auth/providers/github'
import type { GithubProfile } from 'next-auth/providers/github'
import { SupabaseAdapter } from '@next-auth/supabase-adapter'
import { fetchGithubUser } from '@/lib/github'
import { isReserved } from '@/lib/reserved-names'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { ensurePublicUser } from '@/lib/users/ensure-public-user'

// ---------------------------------------------------------------------------
// Gate types (exported for unit testing — pure function, no I/O)
// ---------------------------------------------------------------------------

export interface GateInput {
  login: string
  public_repos: number
  created_at: string // ISO timestamp from GitHub
}

export type GateResult = { ok: true } | { ok: false; redirect: string }

/**
 * Pure function that decides whether a GitHub account may sign up.
 * Runs on every login so a previously-rejected account is re-evaluated.
 *
 * Rules:
 * 1. Reserved username → rejected
 * 2. Account age < 30 days → rejected (encodes actual age in the reason)
 * 3. public_repos < 1 → rejected
 * 4. Otherwise → allowed
 *
 * @param input  - GitHub user fields needed for the decision
 * @param now    - injectable for unit tests; defaults to new Date()
 */
export function evaluateGate(input: GateInput, now: Date = new Date()): GateResult {
  if (isReserved(input.login)) {
    return { ok: false, redirect: '/auth/blocked?reason=reserved_name' }
  }

  const createdAt = new Date(input.created_at).getTime()
  if (Number.isNaN(createdAt)) {
    // Malformed timestamp — fail closed so an unparseable date can't bypass
    // the age check (NaN < 30 is false, which would silently allow signup).
    return { ok: false, redirect: '/auth/blocked?reason=invalid_account_data' }
  }

  const ageDays = Math.floor((now.getTime() - createdAt) / 86_400_000)

  if (ageDays < 30) {
    return { ok: false, redirect: `/auth/blocked?reason=age_${ageDays}_days` }
  }

  if (input.public_repos < 1) {
    return { ok: false, redirect: '/auth/blocked?reason=no_public_repos' }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Audit-column derivation for next_auth.users
//
// Phase 1 added github_login + the two count columns to next_auth.users as
// audit columns, but shipped without populating them. Phase 2's
// sync_user_from_next_auth_trigger fires AFTER UPDATE OF github_login —
// without this populator, no public.users row ever gets created.
//
// Pure function, no I/O. Tested in isolation in auth-audit.test.ts.
// ---------------------------------------------------------------------------

export interface AuditColumns {
  github_login: string
  github_account_age_days_at_signup: number
  github_public_repo_count_at_signup: number
}

export function deriveAuditColumns(
  profile: Pick<GithubProfile, 'login' | 'public_repos' | 'created_at'>,
  now: Date = new Date(),
): AuditColumns {
  const createdMs = new Date(profile.created_at).getTime()
  // Caller is responsible for handling NaN; this function trusts its input
  // because the signIn callback has already validated created_at via the gate.
  const ageDays = Math.floor((now.getTime() - createdMs) / 86_400_000)

  return {
    github_login: profile.login.toLowerCase(),
    github_account_age_days_at_signup: ageDays,
    github_public_repo_count_at_signup: profile.public_repos,
  }
}

// ---------------------------------------------------------------------------
// Admin helper — Phase 12 scaffold
// ---------------------------------------------------------------------------

/**
 * Returns true if the given GitHub login is in the ADMIN_GITHUB_LOGINS
 * env var (comma-separated). Case-insensitive.
 */
export function isAdmin(login: string): boolean {
  const list = (process.env.ADMIN_GITHUB_LOGINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(login.toLowerCase())
}

/**
 * Resolve whether a given user ID has admin privileges by looking up
 * their GitHub login from next_auth.users and checking against the
 * ADMIN_GITHUB_LOGINS env var.
 *
 * Returns false on any error (fail-safe). Creates its own admin client
 * internally so callers don't need to pass a client.
 */
export async function resolveIsAdmin(userId: string): Promise<boolean> {
  if (!userId) return false
  try {
    const supabase = createAdminSupabaseClient()
    const { data } = await supabase
      .schema('next_auth')
      .from('users')
      .select('github_login')
      .eq('id', userId)
      .single()
    const login = (data as { github_login: string } | null)?.github_login ?? ''
    return isAdmin(login)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// NextAuth v4 configuration
// ---------------------------------------------------------------------------

/**
 * Build the NextAuth adapter lazily so that importing this module in
 * unit-test environments (where Supabase env vars are absent) doesn't
 * throw. The adapter is only needed at runtime (route handler), never
 * during pure-function unit tests.
 */
// Next.js sets NEXT_PHASE during `next build` so we can distinguish build
// time (no secrets needed) from request time (secrets required).
function isRequestTimeProd(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  )
}

function buildAdapter() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secret) {
    if (isRequestTimeProd()) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in production',
      )
    }
    return undefined
  }
  return SupabaseAdapter({ url, secret })
}

function buildGithubProvider() {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    if (isRequestTimeProd()) {
      throw new Error(
        'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in production',
      )
    }
    // Build/typecheck/unit-test paths: provider is constructed with empty
    // strings so module load doesn't crash.
    return GithubProvider({ clientId: clientId ?? '', clientSecret: clientSecret ?? '' })
  }
  return GithubProvider({ clientId, clientSecret })
}

export const authOptions: NextAuthOptions = {
  providers: [buildGithubProvider()],

  // DB sessions so we can invalidate them (e.g. mod-bans in Phase 12).
  // SupabaseAdapter requires service-role key — lazy so unit tests pass
  // without Supabase credentials.
  adapter: buildAdapter(),

  session: { strategy: 'database' },

  pages: { signIn: '/auth/signin' },

  callbacks: {
    /**
     * session callback — runs whenever a session is read (e.g. by
     * `getServerSession`). With database sessions, NextAuth passes the
     * DB user row in `user`. We surface its primary-key UUID on
     * `session.user.id` so route handlers (e.g. /api/uploads) can
     * scope writes to the signed-in user.
     *
     * We also look up `public.users.username` and attach it to
     * `session.user.username` so the topbar can link the user to
     * their own profile page (Phase 6). If the row is missing — which
     * happens for users who signed up before Phase 1.1's audit-cols
     * populator landed — we self-heal by calling `ensurePublicUser`
     * so the next session read returns a username and existing
     * signed-in users don't have to log out + back in.
     *
     * All Supabase work is best-effort: if it fails, we surface the
     * session without username and the topbar falls back to the
     * non-link rendering.
     */
    async session({ session, user }) {
      if (session.user && user?.id) {
        session.user.id = user.id

        try {
          const supabase = createAdminSupabaseClient()
          const lookup = await supabase
            .from('users')
            .select('username')
            .eq('id', user.id)
            .maybeSingle<{ username: string }>()

          let username = lookup.data?.username ?? null

          if (!username) {
            // Self-heal: missing public.users row. ensurePublicUser
            // handles next_auth.users → GitHub REST fallbacks.
            username = await ensurePublicUser(supabase, user.id)
          }

          if (username) {
            session.user.username = username
          }
        } catch (err) {
          console.error('[auth] session username lookup failed:', err)
        }
      }
      return session
    },

    /**
     * signIn callback — runs on EVERY successful OAuth handshake.
     * Return true to allow, false to deny, or a URL string to redirect.
     *
     * NextAuth v4 supports returning a redirect string from this callback.
     */
    async signIn({ account }) {
      // No access token means something went wrong upstream.
      if (!account?.access_token) return false

      let gh
      try {
        gh = await fetchGithubUser(account.access_token)
      } catch {
        // If GitHub API is unreachable, fail closed.
        return false
      }

      const result = evaluateGate({
        login: gh.login,
        public_repos: gh.public_repos,
        created_at: gh.created_at,
      })

      if (!result.ok) {
        return result.redirect
      }

      return true
    },
  },

  events: {
    /**
     * Populate the audit columns on next_auth.users that drive Phase 2's
     * sync_user_from_next_auth trigger. Fires AFTER the adapter has
     * inserted or located the user row, so `user.id` is the DB UUID.
     *
     * Runs on every sign-in (not just first) — keeps repo count + age
     * stable across re-evaluation and ensures pre-1.1 users land a
     * public.users row on their next sign-in.
     *
     * Best-effort: a Supabase write failure logs but never blocks login.
     */
    async signIn({ user, profile }) {
      if (!user.id || !profile) return

      const gh = profile as GithubProfile
      if (!gh.login || !gh.created_at || typeof gh.public_repos !== 'number') {
        return
      }

      const cols = deriveAuditColumns(gh)
      if (Number.isNaN(cols.github_account_age_days_at_signup)) return

      try {
        const supabase = createAdminSupabaseClient()
        const { error } = await supabase
          .schema('next_auth')
          .from('users')
          .update(cols)
          .eq('id', user.id)
        if (error) {
          console.error('[auth] audit-column update failed:', error.message)
        }

        // Defensive backstop: even if the audit-column UPDATE fired the
        // Phase 2 trigger successfully, call ensurePublicUser so any
        // surviving missing public.users row gets healed on this sign-in
        // without forcing a sign-out cycle. Best-effort.
        try {
          await ensurePublicUser(supabase, user.id)
        } catch (innerErr) {
          console.error('[auth] ensurePublicUser threw:', innerErr)
        }
      } catch (err) {
        console.error('[auth] audit-column update threw:', err)
      }
    },
  },
}

// ---------------------------------------------------------------------------
// E2E auth shim
//
// Phase 3, Task 11 (Playwright). With NextAuth's database session strategy
// (Supabase adapter), the only way to make a signed-in test request is to
// have a real session row in next_auth.sessions — which CI won't have.
//
// `getSession` wraps `getServerSession(authOptions)` with an opt-in bypass
// gated by THREE conditions, all of which must be true:
//
//   1. `process.env.NODE_ENV !== 'production'`
//      (defence-in-depth: even an accidental env-leak in prod can't enable
//      the shim)
//   2. `process.env.E2E_TEST_AUTH_USER_ID` is a non-empty string
//      (only ever set in `playwright.config.ts`'s `webServer.env`)
//   3. The current request bears the header `x-e2e-auth: 1`
//      (allows individual tests to opt OUT — e.g. the unauth-redirect
//      test omits the header so it sees a real null session and still
//      gets redirected)
//
// We read the request headers off `next/headers`, which works in server
// components and route handlers — both call sites use this helper.
//
// Routes/pages that previously called `getServerSession(authOptions)`
// directly should use `getSession()` so the shim applies uniformly.
// ---------------------------------------------------------------------------

const E2E_FAR_FUTURE = '2099-12-31T23:59:59.000Z'

async function readE2EHeader(): Promise<string | null> {
  try {
    // Lazy import so non-server contexts (the rare misuse during unit
    // tests) don't crash on import.
    const { headers } = await import('next/headers')
    const h = await headers()
    return h.get('x-e2e-auth')
  } catch {
    return null
  }
}

export async function getSession(): Promise<Session | null> {
  const e2eUserId = process.env.E2E_TEST_AUTH_USER_ID
  if (e2eUserId && process.env.NODE_ENV !== 'production') {
    const flag = await readE2EHeader()
    if (flag === '1') {
      return {
        user: {
          id: e2eUserId,
          name: 'e2e-user',
          email: 'e2e-user@example.test',
        },
        expires: E2E_FAR_FUTURE,
      } as Session
    }
  }
  return getServerSession(authOptions)
}
