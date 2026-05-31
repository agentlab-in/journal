import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logRouteError } from '@/lib/logging/error-log'

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleSpy.mockRestore()
})

function lastLogged(): Record<string, unknown> {
  const arg = consoleSpy.mock.calls.at(-1)?.[0]
  expect(typeof arg).toBe('string')
  return JSON.parse(arg as string)
}

describe('logRouteError', () => {
  it('emits a single JSON line per call', () => {
    logRouteError(new Error('boom'), { route: '/api/test' })
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(typeof consoleSpy.mock.calls[0][0]).toBe('string')
  })

  it('shapes Error instances with name, message, stack', () => {
    const err = new Error('boom')
    logRouteError(err, { route: '/api/test', userId: 'u1' })
    const payload = lastLogged()
    expect(payload.route).toBe('/api/test')
    expect(payload.user_id).toBe('u1')
    expect(typeof payload.ts).toBe('string')
    const errShape = payload.err as Record<string, unknown>
    expect(errShape.name).toBe('Error')
    expect(errShape.message).toBe('boom')
    expect(typeof errShape.stack).toBe('string')
  })

  it('omits user_id when not provided but keeps null distinct', () => {
    logRouteError(new Error('x'), { route: '/api/a' })
    expect('user_id' in lastLogged()).toBe(false)

    logRouteError(new Error('x'), { route: '/api/a', userId: null })
    expect(lastLogged().user_id).toBeNull()
  })

  it('handles plain object errors with NonError name', () => {
    logRouteError({ code: 42, msg: 'oops' }, { route: '/api/b' })
    const payload = lastLogged()
    const errShape = payload.err as Record<string, unknown>
    expect(errShape.name).toBe('NonError')
    expect(typeof errShape.message).toBe('string')
    expect(errShape.message).toContain('42')
    expect(errShape.stack).toBeNull()
  })

  it('handles string errors with NonError name', () => {
    logRouteError('something broke', { route: '/api/c' })
    const errShape = lastLogged().err as Record<string, unknown>
    expect(errShape.name).toBe('NonError')
    expect(errShape.message).toBe('something broke')
    expect(errShape.stack).toBeNull()
  })

  it('does not throw on circular objects — falls back to stringify_failed', () => {
    type Circular = { a: number; self?: Circular }
    const circular: Circular = { a: 1 }
    circular.self = circular

    expect(() =>
      logRouteError(circular, { route: '/api/d' }),
    ).not.toThrow()
    const payload = lastLogged()
    expect(payload.log_error).toBe('stringify_failed')
    expect(payload.route).toBe('/api/d')
    expect(typeof payload.ts).toBe('string')
  })

  it('spreads ctx.extra keys at the top level', () => {
    logRouteError(new Error('x'), {
      route: '/api/e',
      extra: { request_id: 'req-1', upstream: 'supabase' },
    })
    const payload = lastLogged()
    expect(payload.request_id).toBe('req-1')
    expect(payload.upstream).toBe('supabase')
  })

  it('redacts denylisted ctx.extra keys to [REDACTED]', () => {
    const secretValue = 'sk_live_supersecret_should_not_appear'
    logRouteError(new Error('x'), {
      route: '/api/f',
      extra: { authorization: `Bearer ${secretValue}` },
    })
    const payload = lastLogged()
    expect(payload.authorization).toBe('[REDACTED]')
    // Ensure the secret never made it to the serialized output.
    const raw = consoleSpy.mock.calls.at(-1)?.[0] as string
    expect(raw).not.toContain(secretValue)
    expect(raw).not.toContain('Bearer')
  })

  it('passes non-denylisted ctx.extra keys through unchanged', () => {
    logRouteError(new Error('x'), {
      route: '/api/g',
      extra: {
        request_id: 'req-2',
        upstream: 'supabase',
        retry_count: 3,
        ok: true,
      },
    })
    const payload = lastLogged()
    expect(payload.request_id).toBe('req-2')
    expect(payload.upstream).toBe('supabase')
    expect(payload.retry_count).toBe(3)
    expect(payload.ok).toBe(true)
  })

  it('canonical fields win when ctx.extra tries to shadow ts/route/err/user_id', () => {
    const realError = new Error('real-error')
    logRouteError(realError, {
      route: '/api/real-route',
      userId: 'real-user',
      extra: {
        route: '/api/spoofed-route',
        ts: 'spoofed-ts',
        err: { name: 'SpoofedError', message: 'pwn', stack: null },
        user_id: 'spoofed-user',
      },
    })
    const payload = lastLogged()
    // Canonical fields must NOT have been shadowed by the spread.
    expect(payload.route).toBe('/api/real-route')
    expect(payload.ts).not.toBe('spoofed-ts')
    expect(typeof payload.ts).toBe('string')
    expect(payload.user_id).toBe('real-user')
    const errShape = payload.err as Record<string, unknown>
    expect(errShape.name).toBe('Error')
    expect(errShape.message).toBe('real-error')
  })

  it('redacts a mix of denylisted keys (varied casing + separators) while passing safe ones through', () => {
    const tokenVal = 'tok_abc123'
    const pwdVal = 'hunter2'
    const cookieVal = 'sid=deadbeef'
    const apiKeyVal = 'ak_999'
    const accessTokenVal = 'at_777'
    const userSecretVal = 'us_555'
    logRouteError(new Error('x'), {
      route: '/api/h',
      extra: {
        Authorization: `Bearer ${tokenVal}`,
        password: pwdVal,
        cookies: cookieVal,
        api_key: apiKeyVal,
        'API-KEY': apiKeyVal,
        apiKey: apiKeyVal,
        accessToken: accessTokenVal,
        userSecret: userSecretVal,
        auth_token: tokenVal,
        request_id: 'req-3',
        upstream: 'supabase',
      },
    })
    const payload = lastLogged()
    expect(payload.Authorization).toBe('[REDACTED]')
    expect(payload.password).toBe('[REDACTED]')
    expect(payload.cookies).toBe('[REDACTED]')
    expect(payload.api_key).toBe('[REDACTED]')
    expect(payload['API-KEY']).toBe('[REDACTED]')
    expect(payload.apiKey).toBe('[REDACTED]')
    expect(payload.accessToken).toBe('[REDACTED]')
    expect(payload.userSecret).toBe('[REDACTED]')
    expect(payload.auth_token).toBe('[REDACTED]')
    expect(payload.request_id).toBe('req-3')
    expect(payload.upstream).toBe('supabase')

    // Belt-and-braces: none of the secret strings should appear in the raw line.
    const raw = consoleSpy.mock.calls.at(-1)?.[0] as string
    for (const s of [tokenVal, pwdVal, cookieVal, apiKeyVal, accessTokenVal, userSecretVal]) {
      expect(raw).not.toContain(s)
    }
  })
})
