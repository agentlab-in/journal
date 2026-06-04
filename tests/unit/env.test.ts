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

  it('parses ADMIN_GITHUB_LOGINS into a trimmed lowercased array (M13)', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ADMIN_GITHUB_LOGINS', ' Harshit , octocat,, FOOBAR ')
    const { ADMIN_GITHUB_LOGINS } = await import('@/lib/env')
    expect(ADMIN_GITHUB_LOGINS).toEqual(['harshit', 'octocat', 'foobar'])
  })

  it('exports an empty ADMIN_GITHUB_LOGINS list when the env var is unset', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ADMIN_GITHUB_LOGINS', undefined as unknown as string)
    const { ADMIN_GITHUB_LOGINS } = await import('@/lib/env')
    expect(ADMIN_GITHUB_LOGINS).toEqual([])
  })

  it('throws at import time in production when NEXTAUTH_SECRET is missing or short (L9)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_SECRET', 'too-short')
    vi.stubEnv('ADMIN_GITHUB_LOGINS', 'harshit')
    await expect(() => import('@/lib/env')).rejects.toThrow(/NEXTAUTH_SECRET/)
  })

  it('throws at import time in production when ADMIN_GITHUB_LOGINS is empty (M13)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv(
      'NEXTAUTH_SECRET',
      'a-very-long-secret-of-at-least-thirty-two-characters',
    )
    vi.stubEnv('ADMIN_GITHUB_LOGINS', '')
    await expect(() => import('@/lib/env')).rejects.toThrow(/ADMIN_GITHUB_LOGINS/)
  })

  it('accepts a valid production env (both gates satisfied)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv(
      'NEXTAUTH_SECRET',
      'a-very-long-secret-of-at-least-thirty-two-characters',
    )
    vi.stubEnv('ADMIN_GITHUB_LOGINS', 'harshit,octocat')
    const { ADMIN_GITHUB_LOGINS, env } = await import('@/lib/env')
    expect(env.NODE_ENV).toBe('production')
    expect(ADMIN_GITHUB_LOGINS).toEqual(['harshit', 'octocat'])
  })

  it('skips the production gate during `next build` (NEXT_PHASE=phase-production-build)', async () => {
    // Vercel preview builds run with NODE_ENV=production but may not have
    // the runtime secrets wired up. The gate must not trip during the
    // build phase or `next build` (and Collecting page data) explodes.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    vi.stubEnv('NEXTAUTH_SECRET', undefined as unknown as string)
    vi.stubEnv('ADMIN_GITHUB_LOGINS', undefined as unknown as string)
    const mod = await import('@/lib/env')
    expect(mod.env.NODE_ENV).toBe('production')
    expect(mod.ADMIN_GITHUB_LOGINS).toEqual([])
  })
})
