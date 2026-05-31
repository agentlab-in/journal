import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { guardMutatingRequest } from '@/lib/route-guard'
import { __resetForTests } from '@/lib/rate-limit'

const OK_ORIGIN = 'http://localhost:3010'
const BAD_ORIGIN = 'https://attacker.example'

beforeEach(() => {
  __resetForTests()
})

afterEach(() => {
  __resetForTests()
})

function req(origin: string | null): Request {
  const headers = new Headers()
  if (origin !== null) headers.set('origin', origin)
  return new Request('http://test/api/x', { method: 'POST', headers })
}

describe('guardMutatingRequest', () => {
  it('returns 403 forbidden_origin when origin is missing', async () => {
    const r = await guardMutatingRequest(req(null), {})
    expect(r.failed).toBe(true)
    if (!r.failed) throw new Error('expected failure')
    expect(r.response.status).toBe(403)
    expect(await r.response.json()).toEqual({ error: 'forbidden_origin' })
  })

  it('returns 403 forbidden_origin when origin is not in allowlist', async () => {
    const r = await guardMutatingRequest(req(BAD_ORIGIN), {})
    expect(r.failed).toBe(true)
    if (!r.failed) throw new Error('expected failure')
    expect(r.response.status).toBe(403)
    expect(await r.response.json()).toEqual({ error: 'forbidden_origin' })
  })

  it('returns ok when origin is allowed and no bucket configured', async () => {
    const r = await guardMutatingRequest(req(OK_ORIGIN), {})
    expect(r.failed).toBe(false)
  })

  it('returns ok when origin good + bucket+userId under limit', async () => {
    const r = await guardMutatingRequest(req(OK_ORIGIN), {
      bucket: 'publish',
      userId: 'user-1',
    })
    expect(r.failed).toBe(false)
  })

  it('returns 429 with Retry-After and rate_limited body when over limit', async () => {
    // Publish bucket has a limit of 10/hour. Burn through it first.
    for (let i = 0; i < 10; i++) {
      const ok = await guardMutatingRequest(req(OK_ORIGIN), {
        bucket: 'publish',
        userId: 'user-burn',
      })
      expect(ok.failed).toBe(false)
    }
    const blocked = await guardMutatingRequest(req(OK_ORIGIN), {
      bucket: 'publish',
      userId: 'user-burn',
    })
    expect(blocked.failed).toBe(true)
    if (!blocked.failed) throw new Error('expected failure')
    expect(blocked.response.status).toBe(429)

    const retryAfterHeader = blocked.response.headers.get('Retry-After')
    expect(retryAfterHeader).not.toBeNull()
    // Header is a string of seconds.
    expect(Number(retryAfterHeader)).toBeGreaterThan(0)

    const body = (await blocked.response.json()) as { error: string; retry_after: number }
    expect(body.error).toBe('rate_limited')
    expect(typeof body.retry_after).toBe('number')
    expect(body.retry_after).toBeGreaterThan(0)
  })

  it('skipOrigin: true with bad origin still returns ok', async () => {
    const r = await guardMutatingRequest(req(BAD_ORIGIN), { skipOrigin: true })
    expect(r.failed).toBe(false)
  })

  it('skipOrigin: true with null origin still returns ok', async () => {
    const r = await guardMutatingRequest(req(null), { skipOrigin: true })
    expect(r.failed).toBe(false)
  })

  it('does NOT rate-limit when bucket is set but userId is null', async () => {
    // null userId means we can't bucket per-user — guard should skip RL.
    for (let i = 0; i < 100; i++) {
      const r = await guardMutatingRequest(req(OK_ORIGIN), {
        bucket: 'publish',
        userId: null,
      })
      expect(r.failed).toBe(false)
    }
  })

  it('does NOT rate-limit when userId is set but bucket is undefined', async () => {
    for (let i = 0; i < 100; i++) {
      const r = await guardMutatingRequest(req(OK_ORIGIN), {
        userId: 'user-2',
      })
      expect(r.failed).toBe(false)
    }
  })
})
