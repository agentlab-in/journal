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
})
