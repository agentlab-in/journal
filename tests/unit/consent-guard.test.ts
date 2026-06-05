import { describe, it, expect, vi } from 'vitest'
import { decideConsentRedirect, loadLatestConsent } from '@/lib/consent/consent-guard'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'

describe('decideConsentRedirect', () => {
  it('returns first-visit signal when row is null', () => {
    expect(decideConsentRedirect(null)).toEqual({
      needs: 'first',
      staleDocs: ['terms', 'content_policy', 'privacy_policy'],
    })
  })

  it('returns null when versions match', () => {
    expect(
      decideConsentRedirect({
        terms_version: LEGAL_VERSIONS.terms,
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual({ needs: null, staleDocs: [] })
  })

  it('returns update signal when one version differs', () => {
    expect(
      decideConsentRedirect({
        terms_version: 'v0',
        content_policy_version: LEGAL_VERSIONS.content_policy,
        privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
      }),
    ).toEqual({ needs: 'update', staleDocs: ['terms'] })
  })
})

describe('loadLatestConsent', () => {
  function mockClient(row: unknown) {
    return {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    } as never
  }

  it('returns the latest row when present', async () => {
    const row = {
      terms_version: 'v1',
      content_policy_version: 'v1',
      privacy_policy_version: 'v1',
    }
    const supabase = mockClient(row)
    await expect(loadLatestConsent(supabase, 'uid-1')).resolves.toEqual(row)
  })

  it('returns null when no row exists', async () => {
    const supabase = mockClient(null)
    await expect(loadLatestConsent(supabase, 'uid-1')).resolves.toBeNull()
  })

  it('returns null on supabase error (fail-closed for redirect)', async () => {
    const supabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'boom' } }),
    } as never
    await expect(loadLatestConsent(supabase, 'uid-1')).resolves.toBeNull()
  })
})
