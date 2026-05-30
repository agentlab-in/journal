/**
 * Phase 14 — Soft-flag heuristic for new signups.
 *
 * Called from the NextAuth signIn callback. Output is persisted to
 * public.users.signup_flags (jsonb). The column is:
 *   - NULL → never evaluated (pre-Phase-14 users)
 *   - {}   → evaluated, no flag tripped
 *   - {...keys} → flags tripped (currently just `thin_profile`)
 *
 * Returning `{}` (never null) means moderators can filter on
 * `signup_flags IS NULL` to find legacy rows.
 */

export interface SoftFlagInput {
  bio: string | null
  email: string | null
  followers: number
}

export interface SoftFlagOutput {
  thin_profile?: true
}

function isEmptyBio(bio: string | null): boolean {
  if (bio === null) return true
  return bio.trim() === ''
}

function isEmailUnset(email: string | null): boolean {
  if (email === null) return true
  return email.trim() === ''
}

export function deriveSignupFlags(input: SoftFlagInput): SoftFlagOutput {
  const flags: SoftFlagOutput = {}
  if (isEmptyBio(input.bio) && isEmailUnset(input.email) && input.followers < 2) {
    flags.thin_profile = true
  }
  return flags
}
