import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))

const loadSpy = vi.fn()
vi.mock('@/lib/consent/consent-guard', async (orig) => {
  const actual = await orig() as Record<string, unknown>
  return { ...actual, loadLatestConsent: loadSpy }
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({}),
}))

describe('requireConsentOrRedirect', () => {
  it('passes through when consent is current', async () => {
    const { requireConsentOrRedirect } = await import('@/lib/consent/require-consent')
    const { LEGAL_VERSIONS } = await import('@/lib/legal/versions')
    loadSpy.mockResolvedValueOnce({
      terms_version: LEGAL_VERSIONS.terms,
      content_policy_version: LEGAL_VERSIONS.content_policy,
      privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
    })
    await expect(requireConsentOrRedirect('uid-1')).resolves.toBeUndefined()
  })

  it('redirects to /auth/consent when no row exists', async () => {
    const { requireConsentOrRedirect } = await import('@/lib/consent/require-consent')
    loadSpy.mockResolvedValueOnce(null)
    await expect(requireConsentOrRedirect('uid-1')).rejects.toThrow(/REDIRECT:\/auth\/consent/)
  })

  it('redirects when a version is stale', async () => {
    const { requireConsentOrRedirect } = await import('@/lib/consent/require-consent')
    loadSpy.mockResolvedValueOnce({
      terms_version: 'v0',
      content_policy_version: 'v1',
      privacy_policy_version: 'v1',
    })
    await expect(requireConsentOrRedirect('uid-1')).rejects.toThrow(/REDIRECT:\/auth\/consent/)
  })
})
