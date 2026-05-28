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
})
