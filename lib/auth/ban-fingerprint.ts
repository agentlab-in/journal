import crypto from 'node:crypto'

/**
 * Canonical hash used by ban_fingerprints rows.
 *
 * The writer (admin ban route) and the reader (signIn callback) MUST
 * produce identical output for the same logical input, so both
 * normalisations are applied here:
 *   1. trim surrounding whitespace
 *   2. lowercase
 *
 * Returns a hex sha256 digest.
 */
export function hashBanFingerprintKey(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

/**
 * Synthetic key used when an email is unavailable but a GitHub
 * providerAccountId is known. Kept here so both call sites format the
 * fallback identically.
 */
export function syntheticProviderKey(providerAccountId: string): string {
  return `gh:${providerAccountId.trim()}`
}
