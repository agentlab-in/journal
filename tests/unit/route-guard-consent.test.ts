import { describe, it, expect, vi, beforeEach } from 'vitest'

const loadSpy = vi.fn()
vi.mock('@/lib/consent/consent-guard', async (orig) => {
  const actual = await orig() as Record<string, unknown>
  return { ...actual, loadLatestConsent: loadSpy }
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({}),
}))
vi.mock('@/lib/security/origin-check', () => ({
  isAllowedOrigin: () => true,
}))

beforeEach(() => loadSpy.mockReset())

describe('guardMutatingRequest with requireConsent', () => {
  it('returns 412 when user has no consent row', async () => {
    const { guardMutatingRequest } = await import('@/lib/route-guard')
    loadSpy.mockResolvedValueOnce(null)
    const req = new Request('https://x/y', { method: 'POST', headers: { origin: 'https://x' } })
    const r = await guardMutatingRequest(req, { userId: 'uid-1', requireConsent: true })
    expect(r.failed).toBe(true)
    if (r.failed) {
      expect(r.response.status).toBe(412)
    }
  })

  it('passes when consent is current', async () => {
    const { guardMutatingRequest } = await import('@/lib/route-guard')
    const { LEGAL_VERSIONS } = await import('@/lib/legal/versions')
    loadSpy.mockResolvedValueOnce({
      terms_version: LEGAL_VERSIONS.terms,
      content_policy_version: LEGAL_VERSIONS.content_policy,
      privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
    })
    const req = new Request('https://x/y', { method: 'POST', headers: { origin: 'https://x' } })
    const r = await guardMutatingRequest(req, { userId: 'uid-1', requireConsent: true })
    expect(r.failed).toBe(false)
  })

  it('skips the consent check when requireConsent is falsy', async () => {
    const { guardMutatingRequest } = await import('@/lib/route-guard')
    const req = new Request('https://x/y', { method: 'POST', headers: { origin: 'https://x' } })
    const r = await guardMutatingRequest(req, { userId: 'uid-1' })
    expect(r.failed).toBe(false)
    expect(loadSpy).not.toHaveBeenCalled()
  })
})
