import '@testing-library/jest-dom'
import { beforeEach, vi } from 'vitest'
import { __resetForTests as resetRateLimit } from '@/lib/rate-limit'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'

// Phase 14 — guardMutatingRequest hits the in-memory rate-limit fallback
// in tests (Upstash env is unset). Without a per-test reset, buckets carry
// across tests inside the same file and exhaust early (publish=10/hour,
// report=10/hour). Reset before every test so each test starts fresh.
beforeEach(() => {
  resetRateLimit()
})

// Issue #57 — every mutating API handler now opts into requireConsent on
// guardMutatingRequest. Existing API unit tests use bespoke fake supabase
// clients that don't seed a `consents` row; without this global mock the
// route-guard fails CLOSED and every test sees 412 instead of the asserted
// status. Override `loadLatestConsent` so the default — used by every API
// test that doesn't care about consent semantics — returns a fully-valid
// row matching LEGAL_VERSIONS. The three dedicated consent test files
// (route-guard-consent / require-consent / consent-guard) declare their
// own per-file `vi.mock('@/lib/consent/consent-guard', …)` which takes
// precedence over this setup-level mock, so their assertions still drive
// the real decision logic.
vi.mock('@/lib/consent/consent-guard', async (orig) => {
  const actual =
    await orig<typeof import('@/lib/consent/consent-guard')>()
  return {
    ...actual,
    loadLatestConsent: vi.fn(async () => ({
      terms_version: LEGAL_VERSIONS.terms,
      content_policy_version: LEGAL_VERSIONS.content_policy,
      privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
    })),
  }
})
