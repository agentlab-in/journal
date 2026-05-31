import { describe, it, expect, afterEach, vi } from 'vitest'

describe('lib/env', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('accepts valid NODE_ENV values', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const { env } = await import('@/lib/env')
    expect(env.NODE_ENV).toBe('test')
  })

  it('throws when NODE_ENV is an invalid value', async () => {
    vi.stubEnv('NODE_ENV', 'invalid-env-value')
    await expect(() => import('@/lib/env')).rejects.toThrow()
  })

  it('passes through UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN when set', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.example.com')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fake-token')
    const { env } = await import('@/lib/env')
    expect(env.UPSTASH_REDIS_REST_URL).toBe('https://upstash.example.com')
    expect(env.UPSTASH_REDIS_REST_TOKEN).toBe('fake-token')
  })

  it('leaves UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN undefined when omitted', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    // Make sure both vars are absent from process.env for this case.
    vi.stubEnv('UPSTASH_REDIS_REST_URL', undefined as unknown as string)
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', undefined as unknown as string)
    const { env } = await import('@/lib/env')
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined()
    expect(env.UPSTASH_REDIS_REST_TOKEN).toBeUndefined()
  })
})
