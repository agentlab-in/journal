import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  checkRateLimit,
  __resetForTests,
  type RateLimitBucket,
} from '@/lib/rate-limit'

beforeEach(() => {
  __resetForTests()
})

afterEach(() => {
  vi.useRealTimers()
  __resetForTests()
})

describe('checkRateLimit (in-memory fallback)', () => {
  it('rejects the 11th call within the publish window', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await checkRateLimit('publish', 'user:alpha')
      expect(r.success).toBe(true)
      expect(r.retryAfter).toBe(0)
    }
    const eleventh = await checkRateLimit('publish', 'user:alpha')
    expect(eleventh.success).toBe(false)
    expect(eleventh.retryAfter).toBeGreaterThan(0)
    expect(eleventh.remaining).toBe(0)
  })

  it('isolates identifiers within the same bucket', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await checkRateLimit('publish', 'user:alpha')
      expect(r.success).toBe(true)
    }
    // Same bucket, different user — should still be allowed.
    const r = await checkRateLimit('publish', 'user:beta')
    expect(r.success).toBe(true)
  })

  it('resets after the window elapses', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    // Saturate the view_count bucket (60/min).
    for (let i = 0; i < 60; i++) {
      const r = await checkRateLimit('view_count', 'user:gamma')
      expect(r.success).toBe(true)
    }
    const blocked = await checkRateLimit('view_count', 'user:gamma')
    expect(blocked.success).toBe(false)

    // Advance past the 1-minute window.
    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'))
    const recovered = await checkRateLimit('view_count', 'user:gamma')
    expect(recovered.success).toBe(true)
  })
})

describe('checkRateLimit bucket limits', () => {
  const cases: Array<{ bucket: RateLimitBucket; limit: number }> = [
    { bucket: 'publish', limit: 10 },
    { bucket: 'edit_post', limit: 30 },
    { bucket: 'delete_post', limit: 30 },
    { bucket: 'report', limit: 10 },
    { bucket: 'image_upload', limit: 20 },
  ]

  for (const { bucket, limit } of cases) {
    it(`bucket '${bucket}' allows exactly ${limit} requests before blocking`, async () => {
      const id = `user:${bucket}`
      for (let i = 0; i < limit; i++) {
        const r = await checkRateLimit(bucket, id)
        expect(r.success).toBe(true)
      }
      const blocked = await checkRateLimit(bucket, id)
      expect(blocked.success).toBe(false)
      expect(blocked.retryAfter).toBeGreaterThan(0)
    })
  }
})
