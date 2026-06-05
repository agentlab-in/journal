import { describe, it, expect } from 'vitest'
import { LEGAL_VERSIONS, staleConsentDocs } from '@/lib/legal/versions'

describe('LEGAL_VERSIONS', () => {
  it('defines string versions for the three docs', () => {
    expect(typeof LEGAL_VERSIONS.terms).toBe('string')
    expect(typeof LEGAL_VERSIONS.content_policy).toBe('string')
    expect(typeof LEGAL_VERSIONS.privacy_policy).toBe('string')
  })
})

describe('staleConsentDocs', () => {
  it('returns all three docs when row is null', () => {
    expect(staleConsentDocs(null).sort()).toEqual(
      ['content_policy', 'privacy_policy', 'terms'].sort(),
    )
  })

  it('returns empty array when all three match current', () => {
    expect(
      staleConsentDocs({
        terms_version: LEGAL_VERSIONS.terms,
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual([])
  })

  it('returns only the bumped doc when one differs', () => {
    expect(
      staleConsentDocs({
        terms_version: 'v0',
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual(['terms'])
  })

  it('treats a null version on the row as stale', () => {
    expect(
      staleConsentDocs({
        terms_version: null,
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual(['terms'])
  })
})
