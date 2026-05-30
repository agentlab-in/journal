import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { __resetForTests as resetRateLimit } from '@/lib/rate-limit'

// Phase 14 — guardMutatingRequest hits the in-memory rate-limit fallback
// in tests (Upstash env is unset). Without a per-test reset, buckets carry
// across tests inside the same file and exhaust early (publish=10/hour,
// report=10/hour). Reset before every test so each test starts fresh.
beforeEach(() => {
  resetRateLimit()
})
