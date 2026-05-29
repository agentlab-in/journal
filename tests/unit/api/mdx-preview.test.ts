/**
 * Validation-only tests for POST /api/mdx/preview.
 *
 * The compile pipeline itself is exercised by tests/unit/mdx/compile.test.ts.
 * Here we only assert the route's guard rails:
 *   - unauthenticated → 401
 *   - missing/malformed JSON body → 400
 *   - body_md missing or wrong type → 400
 *   - body_md over MAX_LENGTH chars → 413
 *   - valid body when authenticated → 200 with compiled payload
 *   - valid body when authenticated, MDX has a syntax error → 422 with error
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mock for next-auth session lookup. Default = signed in; tests
// flip this to `null` to assert the 401 path.
const sessionMock = vi.hoisted(() => ({ current: { user: { id: 'u-1' } } as null | { user: { id: string } } }))
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(async () => sessionMock.current),
}))

// authOptions is referenced by the route but never invoked by the mocked
// getServerSession — stub the module so we don't drag in Supabase env vars.
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { POST, MAX_LENGTH } from '@/app/api/mdx/preview/route'

function jsonRequest(body: unknown, init?: { stringifyOverride?: string }): Request {
  const payload = init?.stringifyOverride ?? JSON.stringify(body)
  return new Request('http://localhost/api/mdx/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  })
}

beforeEach(() => {
  sessionMock.current = { user: { id: 'u-1' } }
})

describe('POST /api/mdx/preview — validation', () => {
  it('returns 401 when there is no session', async () => {
    sessionMock.current = null
    const res = await POST(jsonRequest({ body_md: '# hi' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('unauthorized')
  })

  it('returns 400 when the JSON body is unparseable', async () => {
    const res = await POST(jsonRequest({}, { stringifyOverride: 'not json{' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_json')
  })

  it('returns 400 when body_md is missing', async () => {
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_body')
  })

  it('returns 400 when body_md is not a string', async () => {
    const res = await POST(jsonRequest({ body_md: 42 }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_body')
  })

  it('returns 413 when body_md exceeds MAX_LENGTH', async () => {
    const huge = 'a'.repeat(MAX_LENGTH + 1)
    const res = await POST(jsonRequest({ body_md: huge }))
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.error).toBe('body_too_large')
  })

  it('returns 200 with a compiledSource on valid input', async () => {
    const res = await POST(jsonRequest({ body_md: '# Hello' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.compiledSource).toBe('string')
    expect(json.compiledSource.length).toBeGreaterThan(0)
  })

  it('returns 422 with an error payload when the MDX fails to compile', async () => {
    // Unbalanced JSX expression — `serialize` will throw.
    const res = await POST(jsonRequest({ body_md: '<Callout>oops' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBeDefined()
    expect(typeof json.error.message).toBe('string')
    expect(json.error.message.length).toBeGreaterThan(0)
  })

  it('accepts body_md at exactly MAX_LENGTH', async () => {
    const maxOk = 'a'.repeat(MAX_LENGTH)
    const res = await POST(jsonRequest({ body_md: maxOk }))
    expect(res.status).toBe(200)
  })
})
