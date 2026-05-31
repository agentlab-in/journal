import { describe, it, expect } from 'vitest'
import { readRetryAfter } from '@/lib/client/retry-after'

/**
 * Build a Response that exposes both a JSON body and a Retry-After header
 * depending on what the caller wants to assert. Either or both may be
 * omitted to exercise the fallback chain.
 */
function makeResponse(opts: {
  body?: unknown
  retryAfterHeader?: string | null
}): Response {
  const headers = new Headers()
  if (opts.retryAfterHeader !== undefined && opts.retryAfterHeader !== null) {
    headers.set('Retry-After', opts.retryAfterHeader)
  }
  const init: ResponseInit = { status: 429, headers }
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(opts.body), init)
  }
  return new Response(null, init)
}

describe('readRetryAfter', () => {
  it('prefers JSON body retry_after when present', async () => {
    const res = makeResponse({
      body: { retry_after: 5 },
      retryAfterHeader: '999',
    })
    expect(await readRetryAfter(res)).toBe(5)
  })

  it('falls back to Retry-After header when JSON body has no retry_after', async () => {
    const res = makeResponse({
      body: { error: 'rate_limited' },
      retryAfterHeader: '12',
    })
    expect(await readRetryAfter(res)).toBe(12)
  })

  it('returns the Retry-After header value when body is absent', async () => {
    const res = makeResponse({ retryAfterHeader: '12' })
    expect(await readRetryAfter(res)).toBe(12)
  })

  it('returns the 30s default when neither body nor header is set', async () => {
    const res = makeResponse({})
    expect(await readRetryAfter(res)).toBe(30)
  })

  it('returns the 30s default when the header is non-numeric', async () => {
    const res = makeResponse({ retryAfterHeader: 'not-a-number' })
    expect(await readRetryAfter(res)).toBe(30)
  })

  it('ignores a negative retry_after in body and falls through', async () => {
    const res = makeResponse({ body: { retry_after: -5 } })
    expect(await readRetryAfter(res)).toBe(30)
  })

  it('ignores a zero retry_after in body (UX would render "0s")', async () => {
    const res = makeResponse({
      body: { retry_after: 0 },
      retryAfterHeader: '7',
    })
    expect(await readRetryAfter(res)).toBe(7)
  })

  it('rounds fractional seconds UP so the user never under-waits', async () => {
    const res = makeResponse({ body: { retry_after: 4.2 } })
    expect(await readRetryAfter(res)).toBe(5)
  })

  it('does not consume the body — caller can still read res.json() afterwards', async () => {
    const res = makeResponse({ body: { retry_after: 3, payload: 'hi' } })
    await readRetryAfter(res)
    const json = (await res.json()) as { payload: string }
    expect(json.payload).toBe('hi')
  })

  it('handles a non-JSON body gracefully by falling through to header', async () => {
    const res = new Response('not json at all', {
      status: 429,
      headers: { 'Retry-After': '8' },
    })
    expect(await readRetryAfter(res)).toBe(8)
  })
})
