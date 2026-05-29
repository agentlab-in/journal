import type { NextAuthOptions } from 'next-auth'
import GithubProvider from 'next-auth/providers/github'
import { SupabaseAdapter } from '@next-auth/supabase-adapter'
import { fetchGithubUser } from '@/lib/github'
import { isReserved } from '@/lib/reserved-names'

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
}
