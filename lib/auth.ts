import type { NextAuthOptions, Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import GithubProvider from 'next-auth/providers/github'
import type { GithubProfile } from 'next-auth/providers/github'
import { SupabaseAdapter } from '@next-auth/supabase-adapter'
import { fetchGithubUser } from '@/lib/github'
import { isReserved } from '@/lib/reserved-names'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { ensurePublicUser } from '@/lib/users/ensure-public-user'
import { deriveSignupFlags } from '@/lib/auth/soft-flag'
import { hashBanFingerprintKey, syntheticProviderKey } from '@/lib/auth/ban-fingerprint'
import { logRouteError } from '@/lib/logging/error-log'
import { syncUserGithubOrgs } from '@/lib/orgs/github-sync'

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
  // GitHub handle shape — same regex used by the blocked page when it
  // sanitises the `login` query param. Anything outside this shape can't
  // be appended to the redirect URL, so the page never has to render
  // arbitrary text from the redirect.
  const safeLogin =
    typeof input.login === 'string' && /^[a-z0-9-]{1,39}$/i.test(input.login)
      ? `&login=${encodeURIComponent(input.login.toLowerCase())}`
      : ''

  if (isReserved(input.login)) {
    return { ok: false, redirect: `/auth/blocked?reason=reserved_name${safeLogin}` }
  }

  const createdAt = new Date(input.created_at).getTime()
  if (Number.isNaN(createdAt)) {
    // Malformed timestamp — fail closed so an unparseable date can't bypass
    // the age check (NaN < 30 is false, which would silently allow signup).
    return { ok: false, redirect: `/auth/blocked?reason=invalid_account_data${safeLogin}` }
  }

  const ageDays = Math.floor((now.getTime() - createdAt) / 86_400_000)

  if (ageDays < 30) {
    return { ok: false, redirect: `/auth/blocked?reason=age_${ageDays}_days${safeLogin}` }
  }

  if (input.public_repos < 1) {
    return { ok: false, redirect: `/auth/blocked?reason=no_public_repos${safeLogin}` }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Ban-redirect helper (exported for unit testing — pure function, no I/O)
// ---------------------------------------------------------------------------

/**
 * Pure function that decides whether a banned user should be redirected.
 *
 * Returns null when not banned (banned_at is null), or a redirect URL string
 * when the user is banned. The login is appended only when it passes the
 * same GitHub handle shape check used by evaluateGate.
 */
export function decideBanRedirect(input: {
  login: string
  banned_at: string | null
}): string | null {
  if (!input.banned_at) return null

  const safeLogin =
    typeof input.login === 'string' && /^[a-z0-9-]{1,39}$/i.test(input.login)
      ? `&login=${encodeURIComponent(input.login.toLowerCase())}`
      : ''

  return `/auth/blocked?reason=banned${safeLogin}`
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

// `read:org` is required by Phase 11.5 so events.signIn can pull the user's
// GitHub-org memberships via /user/orgs and sync them into public.orgs +
// org_members. GitHub will re-prompt existing users on their next sign-in to
// consent to the new scope; if a user denies it, the access_token still
// signs them in but /user/orgs returns 403 / [] and syncUserGithubOrgs
// no-ops — sync is best-effort, not a sign-in requirement.
export const GITHUB_OAUTH_SCOPE = 'read:user user:email read:org'

export function buildGithubProvider() {
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
    return GithubProvider({
      clientId: clientId ?? '',
      clientSecret: clientSecret ?? '',
      authorization: { params: { scope: GITHUB_OAUTH_SCOPE } },
    })
  }
  return GithubProvider({
    clientId,
    clientSecret,
    authorization: { params: { scope: GITHUB_OAUTH_SCOPE } },
  })
}

// ---------------------------------------------------------------------------
// public.users profile reader
//
// Returns username + display_name + avatar_url for the session callback.
// Kept as a private helper (not exported) so the session callback can
// re-read after self-heal without duplicating the chained query.
// ---------------------------------------------------------------------------

interface PublicUserProfile {
  username: string
  display_name: string | null
  avatar_url: string | null
}

async function readPublicUserProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<PublicUserProfile | null> {
  const lookup = await supabase
    .from('users')
    .select('username, display_name, avatar_url')
    .eq('id', userId)
    .maybeSingle<PublicUserProfile>()
  return lookup.data ?? null
}

/**
 * Last-resort fallback for the session callback: when both the
 * public.users lookup AND ensurePublicUser have failed to surface a
 * username, read next_auth.users.github_login directly.
 *
 * next_auth.users always exists by the time the session callback runs
 * because the SupabaseAdapter inserts (or finds) it BEFORE NextAuth
 * writes the session cookie. The race that triggers a missing
 * public.users row — events.signIn populating public.users in
 * parallel with the first GET /api/auth/session — does NOT affect
 * next_auth.users, so this read is reliable on the first call.
 *
 * Returns the lowercased login or null if even this lookup fails.
 */
async function readNextAuthGithubLogin(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .schema('next_auth')
      .from('users')
      .select('github_login')
      .eq('id', userId)
      .maybeSingle<{ github_login: string | null }>()
    const login = data?.github_login?.toLowerCase().trim()
    return login ? login : null
  } catch (err) {
    console.error('[auth] next_auth.users github_login fallback failed:', err)
    return null
  }
}

export const authOptions: NextAuthOptions = {
  providers: [buildGithubProvider()],

  // DB sessions so we can invalidate them (e.g. mod-bans in Phase 12).
  // SupabaseAdapter requires service-role key — lazy so unit tests pass
  // without Supabase credentials.
  adapter: buildAdapter(),

  session: { strategy: 'database' },

  pages: { signIn: '/auth/signin' },

  // Pin the session cookie config so a future change can't silently widen
  // it to `domain: '.agentlab.in'` and start sharing sessions between dev
  // and prod. NextAuth v4 defaults are the same shape — we just freeze
  // them at the source.
  //
  // `useSecureCookies` mirrors NextAuth's own derivation
  // (node_modules/next-auth/core/init.js): the Secure flag and the
  // `__Secure-` name prefix flip on when NEXTAUTH_URL is https, not
  // on NODE_ENV. Keying on NODE_ENV would regress dev-over-https
  // setups (ngrok, `vercel dev`, etc.) where NextAuth would otherwise
  // write a `__Secure-` cookie.
  cookies: (() => {
    const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false
    return {
      sessionToken: {
        name: `${useSecureCookies ? '__Secure-' : ''}next-auth.session-token`,
        options: {
          httpOnly: true,
          sameSite: 'lax' as const,
          path: '/',
          secure: useSecureCookies,
          // intentionally NO `domain` — keep cookies host-scoped so
          // dev.agentlab.in and agentlab.in have separate sessions.
        },
      },
    }
  })(),

  callbacks: {
    /**
     * session callback — runs whenever a session is read (e.g. by
     * `getServerSession`). With database sessions, NextAuth passes the
     * DB user row in `user`. We surface its primary-key UUID on
     * `session.user.id` so route handlers (e.g. /api/uploads) can
     * scope writes to the signed-in user.
     *
     * We also look up `public.users` (username + display_name +
     * avatar_url) and use it to:
     *   - attach `session.user.username` so the topbar can link to
     *     the profile page (Phase 6);
     *   - OVERRIDE `session.user.name` with display_name, and
     *     OVERRIDE `session.user.image` with avatar_url when present.
     *
     * The override exists because @next-auth/supabase-adapter@0.2.1
     * ships a broken `format()` helper that coerces ANY date-parseable
     * string column it finds into a Date object. Many GitHub logins
     * (e.g. short numeric strings like "317", or strings that look
     * like partial dates) parse as valid dates, so the adapter
     * silently rewrites `next_auth.users.name` to a Date, which
     * NextAuth then ISO-8601-serializes into the session and the
     * topbar renders as e.g. "0317-12-31T18:06:32.000Z". `public.users`
     * is populated by a plain Postgres trigger (Phase 2) and read here
     * with plain text columns, so it's not affected by the bug.
     *
     * Email is left alone — email columns aren't parseable as dates,
     * so the bug doesn't bite there.
     *
     * If the row is missing — which happens for users who signed up
     * before Phase 1.1's audit-cols populator landed — we self-heal
     * by calling `ensurePublicUser`, then re-read display_name +
     * avatar_url so the first render after self-heal already has the
     * correct name (no need to log out + back in).
     *
     * All Supabase work is best-effort: if it fails, we surface the
     * session unchanged and the topbar falls back to whatever the
     * adapter passed in.
     */
    async session({ session, user }) {
      if (session.user && user?.id) {
        session.user.id = user.id

        try {
          const supabase = createAdminSupabaseClient()
          let profile = await readPublicUserProfile(supabase, user.id)

          if (!profile) {
            // Self-heal: missing public.users row. ensurePublicUser
            // handles next_auth.users → GitHub REST fallbacks. After
            // it returns, re-read so name/image overrides apply on
            // this same session render.
            const healedUsername = await ensurePublicUser(supabase, user.id)
            if (healedUsername) {
              profile = (await readPublicUserProfile(supabase, user.id)) ?? {
                username: healedUsername,
                display_name: null,
                avatar_url: null,
              }
            } else {
              // Deeper race / null-return paths in ensurePublicUser
              // (e.g. naUser.data missing, accounts lookup empty,
              // GitHub REST failing) leave us with no username. The
              // actual real-user symptom is the first GET
              // /api/auth/session firing while events.signIn is still
              // running server-side, so public.users may not exist
              // yet — but next_auth.users always does by this point
              // (the SupabaseAdapter creates it before the session
              // cookie is written). Read github_login directly as a
              // last-resort surface so session.user.username is
              // ALWAYS present on the first call. display_name +
              // avatar_url stay null; the topbar can still render
              // the profile link, which is the user-visible bug.
              const fallbackLogin = await readNextAuthGithubLogin(supabase, user.id)
              if (fallbackLogin) {
                profile = {
                  username: fallbackLogin,
                  display_name: null,
                  avatar_url: null,
                }
              }
            }
          }

          if (profile?.username) {
            session.user.username = profile.username
          }
          if (profile?.display_name) {
            session.user.name = profile.display_name
          }
          if (profile?.avatar_url) {
            session.user.image = profile.avatar_url
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

      // Ban check — three layers:
      //   (a) public.users.banned_at for the OAuth-mapped user row;
      //   (b) ban_fingerprints by sha256(email) — same human, new GitHub account;
      //   (c) ban_fingerprints by providerAccountId — same GitHub account, new email.
      //
      // Fail-CLOSED: a Supabase error here used to bypass the check; combined
      // with the per-request `banned_at` recheck in getSession(), a transient
      // blip is recoverable on the next request, so denying sign-in is safe.
      //
      // banRowFound tracks (a) — Phase 11's downstream org-slug collision check
      // skips for users that already legitimately hold their username.
      let banRowFound = false
      try {
        const username = gh.login.toLowerCase()
        const supabase = createAdminSupabaseClient()
        const { data: banRow, error: banError } = await supabase
          .from('users')
          .select('id, banned_at')
          .eq('username', username)
          .maybeSingle<{ id: string; banned_at: string | null }>()

        if (banError) {
          console.error('[auth] ban lookup error (fail-closed):', banError.message)
          return `/auth/blocked?reason=lookup_error&login=${encodeURIComponent(username)}`
        }
        if (banRow) {
          banRowFound = true
          const redirect = decideBanRedirect({ login: username, banned_at: banRow.banned_at })
          if (redirect) {
            return redirect
          }
        }

        // Fingerprint match — covers re-ban evasion with a second GitHub
        // account or a renamed/reused email.
        const candidateHashes: string[] = []
        if (gh.email && gh.email.trim().length > 0) {
          candidateHashes.push(hashBanFingerprintKey(gh.email))
        }
        const providerAccountIdRaw =
          typeof account.providerAccountId === 'string' ? account.providerAccountId.trim() : ''
        const providerAccountId = providerAccountIdRaw.length > 0 ? providerAccountIdRaw : null
        if (providerAccountId) {
          // Synthetic hash mirrors the writer in /api/admin/ban for the
          // email-less path so a fingerprint stored under `gh:<id>` still
          // matches even when this sign-in lacks an email.
          candidateHashes.push(hashBanFingerprintKey(syntheticProviderKey(providerAccountId)))
        }

        if (candidateHashes.length > 0) {
          const { data: hashMatch, error: hashErr } = await supabase
            .from('ban_fingerprints')
            .select('email_hash')
            .in('email_hash', candidateHashes)
            .limit(1)
            .maybeSingle<{ email_hash: string }>()
          if (hashErr) {
            console.error('[auth] ban_fingerprints email lookup error (fail-closed):', hashErr.message)
            return `/auth/blocked?reason=lookup_error&login=${encodeURIComponent(username)}`
          }
          if (hashMatch) {
            return `/auth/blocked?reason=banned&login=${encodeURIComponent(username)}`
          }
        }

        if (providerAccountId) {
          const { data: idMatch, error: idErr } = await supabase
            .from('ban_fingerprints')
            .select('email_hash')
            .eq('provider_account_id', providerAccountId)
            .limit(1)
            .maybeSingle<{ email_hash: string }>()
          if (idErr) {
            console.error('[auth] ban_fingerprints provider lookup error (fail-closed):', idErr.message)
            return `/auth/blocked?reason=lookup_error&login=${encodeURIComponent(username)}`
          }
          if (idMatch) {
            return `/auth/blocked?reason=banned&login=${encodeURIComponent(username)}`
          }
        }
      } catch (banErr) {
        console.error('[auth] ban lookup threw (fail-closed):', banErr)
        return `/auth/blocked?reason=lookup_error&login=${encodeURIComponent(gh.login.toLowerCase())}`
      }

      // Phase 11: cross-table org-slug collision check.
      // Only run for FUTURE users — existing public.users rows legitimately
      // hold their username. If banRowFound is true the row already exists.
      // Fail-open (matches ban-lookup posture). Cross-table uniqueness is not
      // DB-enforced; this is a best-effort signup-time gate.
      if (!banRowFound) {
        try {
          const username = gh.login.toLowerCase()
          const safeLogin = /^[a-z0-9-]{1,39}$/i.test(username)
            ? `&login=${encodeURIComponent(username)}`
            : ''
          const supabase = createAdminSupabaseClient()
          const { data: orgRow, error: orgError } = await supabase
            .from('orgs')
            .select('id')
            .eq('slug', username)
            .maybeSingle<{ id: string }>()

          if (orgError) {
            console.error('[auth] org-slug lookup error (fail-open):', orgError.message)
          } else if (orgRow) {
            return `/auth/blocked?reason=username_taken_by_org${safeLogin}`
          }
        } catch (orgErr) {
          console.error('[auth] org-slug lookup threw (fail-open):', orgErr)
        }
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
    async signIn({ user, account }) {
      if (!user.id) return
      if (!account?.access_token) return

      // The `profile` arg NextAuth passes here is the mapped User shape
      // ({ id, name, email, image }), NOT the raw GitHub /user response —
      // so the GitHub-specific fields we need (login, public_repos,
      // created_at, bio, followers) come from a fresh /user fetch. This
      // mirrors the pattern callbacks.signIn already uses.
      let gh
      try {
        gh = await fetchGithubUser(account.access_token as string)
      } catch (err) {
        console.error('[auth] events.signIn: fetchGithubUser threw:', err)
        return
      }
      if (!gh.login || !gh.created_at || typeof gh.public_repos !== 'number') return

      const cols = deriveAuditColumns(gh)
      if (Number.isNaN(cols.github_account_age_days_at_signup)) return

      // Each best-effort step below has its own try/catch so one failure
      // can't poison the others. Construct supabase up front; if THAT throws
      // there's nothing useful to do here — log and bail.
      let supabase: ReturnType<typeof createAdminSupabaseClient>
      try {
        supabase = createAdminSupabaseClient()
      } catch (err) {
        console.error('[auth] createAdminSupabaseClient threw:', err)
        return
      }

      try {
        const { error } = await supabase
          .schema('next_auth')
          .from('users')
          .update(cols)
          .eq('id', user.id)
        if (error) {
          console.error('[auth] audit-column update failed:', error.message)
        }
      } catch (err) {
        console.error('[auth] audit-column update threw:', err)
      }

      // Defensive backstop: even if the audit-column UPDATE fired the
      // Phase 2 trigger successfully, call ensurePublicUser so any
      // surviving missing public.users row gets healed on this sign-in
      // without forcing a sign-out cycle. Best-effort.
      try {
        await ensurePublicUser(supabase, user.id)
      } catch (err) {
        console.error('[auth] ensurePublicUser threw:', err)
      }

      // Phase 11.5: pull the user's GitHub-org memberships and reconcile
      // them into public.orgs + org_members. The access_token is available
      // because we requested `read:org` scope; if the user denied the scope
      // at consent, /user/orgs returns 403 and syncUserGithubOrgs returns
      // the no-op tuple.
      try {
        const result = await syncUserGithubOrgs({
          supabase,
          userId: user.id,
          githubAccessToken: account.access_token as string,
        })
        if (result.added.length > 0 || result.removed.length > 0) {
          console.info('[auth] github org sync delta:', {
            userId: user.id,
            added: result.added,
            removed: result.removed,
            total: result.total,
          })
        }
      } catch (err) {
        console.error('[auth] github org sync threw:', err)
      }

      // Phase 14: derive signup_flags from the GitHub profile and write
      // to public.users. Best-effort — moderators read this column as a
      // soft-signal triage hint; failure must NEVER block login.
      try {
        const flags = deriveSignupFlags({
          bio: gh.bio,
          email: gh.email,
          followers: gh.followers,
        })
        const username = gh.login.toLowerCase()
        const { error: flagsErr } = await supabase
          .from('users')
          .update({ signup_flags: flags })
          .eq('username', username)
        if (flagsErr) {
          logRouteError(flagsErr, {
            route: 'events.signIn:signup_flags',
            userId: user.id,
          })
        }
      } catch (flagsThrew) {
        logRouteError(flagsThrew, {
          route: 'events.signIn:signup_flags',
          userId: user.id,
        })
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

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return session

  // Per-request banned check. The 0015 session-invalidator trigger deletes
  // sessions when a user is banned, so a live cookie usually fails the
  // adapter's session lookup first — but a moderator may flip banned_at via
  // SQL or a backfill path that bypasses the trigger, and the trigger only
  // fires on the UPDATE; so we recheck here to keep banned users out of
  // every authenticated request (read or write).
  try {
    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from('users')
      .select('banned_at')
      .eq('id', session.user.id)
      .maybeSingle<{ banned_at: string | null }>()
    if (error) {
      console.error('[auth] per-request ban lookup error:', error.message)
      // Fail-closed: drop the session rather than letting a banned user act.
      return null
    }
    if (data?.banned_at) {
      return null
    }
  } catch (err) {
    console.error('[auth] per-request ban lookup threw:', err)
    return null
  }

  return session
}
