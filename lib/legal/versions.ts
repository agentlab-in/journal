/**
 * Issue #57 — Legal-doc version constants.
 *
 * Bumping a value here is the operator's manual signal that a doc has
 * been edited materially enough to re-prompt every user. The version
 * string is recorded in public.consents at submission time; the
 * consent-guard compares the stored row's versions against these
 * constants on every authed request and redirects to /auth/consent
 * on any mismatch.
 *
 * Convention: semver-style ('v1', 'v2', …). Bump in lockstep with the
 * corresponding doc's frontmatter line; see lib/legal/README.md.
 */
export const LEGAL_VERSIONS = {
  terms: 'v1',
  content_policy: 'v1',
  privacy_policy: 'v1',
} as const

export type LegalDoc = keyof typeof LEGAL_VERSIONS

export interface StoredConsentVersions {
  terms_version: string | null
  content_policy_version: string | null
  privacy_policy_version: string | null
}

/**
 * Returns the list of docs whose stored consent version differs from
 * the current `LEGAL_VERSIONS`. A null row (no consent on record)
 * returns all three. An exact triple-match returns `[]`.
 *
 * Pure; safe to call from any context.
 */
export function staleConsentDocs(
  stored: StoredConsentVersions | null,
): LegalDoc[] {
  if (stored === null) {
    return ['terms', 'content_policy', 'privacy_policy']
  }
  const stale: LegalDoc[] = []
  if (stored.terms_version !== LEGAL_VERSIONS.terms) stale.push('terms')
  if (stored.content_policy_version !== LEGAL_VERSIONS.content_policy) {
    stale.push('content_policy')
  }
  if (stored.privacy_policy_version !== LEGAL_VERSIONS.privacy_policy) {
    stale.push('privacy_policy')
  }
  return stale
}
