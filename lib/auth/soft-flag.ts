/**
 * Phase 14 — Soft-flag heuristic for new signups.
 *
 * Called from the NextAuth signIn callback. Output is persisted to
 * public.users.signup_flags (jsonb). The column is:
 *   - NULL → never evaluated (pre-Phase-14 users)
 *   - {}   → evaluated, no flag tripped
 *   - {...keys} → flags tripped
 *
 * Returning `{}` (never null) means moderators can filter on
 * `signup_flags IS NULL` to find legacy rows.
 *
 * M17 (audit follow-up): the original heuristic only set `thin_profile`
 * when bio + email + low-follower count ALL coincided — a bot with 2
 * followers and a one-character bio sailed through. We now emit a set
 * of independent additive signals (account age, repo count, follower
 * and following counts, bio quality, public email) so moderators can
 * triage on combinations a single coarse flag could not surface.
 *
 * Important: none of these flags BLOCK login. The hard signup gate
 * (30-day account age + ≥1 public repo) lives in `lib/auth.ts`'s
 * `callbacks.signIn`. Flags here are soft signals only.
 */

export interface SoftFlagInput {
  bio: string | null
  email: string | null
  followers: number
  following: number
  publicRepos: number
  /** ISO 8601 string from GitHub's /user.created_at, or null when unavailable. */
  createdAt: string | null
}

export interface SoftFlagOutput {
  /** Legacy combined signal: bio empty + email unset + followers < 2. */
  thin_profile?: true
  /** GitHub account younger than YOUNG_ACCOUNT_DAYS. */
  young_account?: true
  /** Fewer than LOW_REPOS public repos. */
  low_repos?: true
  /** Fewer than LOW_FOLLOWERS followers. */
  low_followers?: true
  /** Fewer than LOW_FOLLOWING accounts followed. */
  low_following?: true
  /** Bio missing or whitespace-only. */
  empty_bio?: true
  /** Bio non-empty but shorter than SHORT_BIO_CHARS (after trim). */
  short_bio?: true
  /** Public email unset on the GitHub profile. */
  no_public_email?: true
}

const YOUNG_ACCOUNT_DAYS = 90
const LOW_REPOS = 3
const LOW_FOLLOWERS = 2
const LOW_FOLLOWING = 2
const SHORT_BIO_CHARS = 8
const MS_PER_DAY = 1000 * 60 * 60 * 24

function trimmedBio(bio: string | null): string {
  return bio === null ? '' : bio.trim()
}

function isEmailUnset(email: string | null): boolean {
  if (email === null) return true
  return email.trim() === ''
}

function accountAgeDays(createdAt: string | null, now: Date): number | null {
  if (!createdAt) return null
  const created = Date.parse(createdAt)
  if (Number.isNaN(created)) return null
  const ageMs = now.getTime() - created
  if (ageMs < 0) return null
  return Math.floor(ageMs / MS_PER_DAY)
}

export function deriveSignupFlags(
  input: SoftFlagInput,
  now: Date = new Date(),
): SoftFlagOutput {
  const flags: SoftFlagOutput = {}
  const bio = trimmedBio(input.bio)
  const emailUnset = isEmailUnset(input.email)

  // Legacy combined signal kept verbatim so historical rows remain comparable.
  if (bio === '' && emailUnset && input.followers < LOW_FOLLOWERS) {
    flags.thin_profile = true
  }

  if (bio === '') flags.empty_bio = true
  else if (bio.length < SHORT_BIO_CHARS) flags.short_bio = true

  if (emailUnset) flags.no_public_email = true
  if (input.followers < LOW_FOLLOWERS) flags.low_followers = true
  if (input.following < LOW_FOLLOWING) flags.low_following = true
  if (input.publicRepos < LOW_REPOS) flags.low_repos = true

  const ageDays = accountAgeDays(input.createdAt, now)
  if (ageDays !== null && ageDays < YOUNG_ACCOUNT_DAYS) {
    flags.young_account = true
  }

  return flags
}
