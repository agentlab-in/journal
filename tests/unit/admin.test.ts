/**
 * Unit tests for lib/admin.ts — requireAdmin and requireAdminApi.
 *
 * Mock strategy (mirrors auth-session.test.ts):
 *   - vi.mock('@/lib/auth', ...) to intercept resolveIsAdmin
 *   - vi.mock('next/navigation', ...) to intercept notFound
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session } from 'next-auth'

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE the import that triggers module load
// ---------------------------------------------------------------------------

const resolveIsAdmin = vi.fn<() => Promise<boolean>>()

vi.mock('@/lib/auth', () => ({
  resolveIsAdmin: (...args: unknown[]) => resolveIsAdmin(...(args as [])),
}))

// notFound() in Next.js throws a special error to terminate render.
// We model that by throwing a sentinel error so we can assert it was called.
class NotFoundSentinel extends Error {
  constructor() {
    super('NEXT_NOT_FOUND')
    this.name = 'NotFoundSentinel'
  }
}

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFoundSentinel()
  },
}))

// Import AFTER mocks are registered.
import { requireAdmin, requireAdminApi } from '@/lib/admin'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(id: string): Session {
  return {
    user: { id, email: 'a@b.com', name: 'Test User' },
    expires: '2099-12-31T23:59:59.000Z',
  }
}

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe('requireAdmin()', () => {
  beforeEach(() => {
    resolveIsAdmin.mockReset()
  })

  it('returns session.user.id when the user is an admin', async () => {
    resolveIsAdmin.mockResolvedValue(true)
    const result = await requireAdmin(makeSession('u1'))
    expect(result).toBe('u1')
    expect(resolveIsAdmin).toHaveBeenCalledWith('u1')
  })

  it('calls notFound() (throws) when session is null', async () => {
    await expect(requireAdmin(null)).rejects.toBeInstanceOf(NotFoundSentinel)
    expect(resolveIsAdmin).not.toHaveBeenCalled()
  })

  it('calls notFound() (throws) when session has no user.id', async () => {
    const session = { user: { email: 'x@y.com' }, expires: '2099-12-31' } as unknown as Session
    await expect(requireAdmin(session)).rejects.toBeInstanceOf(NotFoundSentinel)
    expect(resolveIsAdmin).not.toHaveBeenCalled()
  })

  it('calls notFound() (throws) when user is authed but not an admin', async () => {
    resolveIsAdmin.mockResolvedValue(false)
    await expect(requireAdmin(makeSession('u2'))).rejects.toBeInstanceOf(NotFoundSentinel)
    expect(resolveIsAdmin).toHaveBeenCalledWith('u2')
  })
})

// ---------------------------------------------------------------------------
// requireAdminApi
// ---------------------------------------------------------------------------

describe('requireAdminApi()', () => {
  beforeEach(() => {
    resolveIsAdmin.mockReset()
  })

  it('returns null when the user is an admin', async () => {
    resolveIsAdmin.mockResolvedValue(true)
    const result = await requireAdminApi(makeSession('u3'))
    expect(result).toBeNull()
  })

  it('returns 401 { error: "unauthorized" } when session is null', async () => {
    const resp = await requireAdminApi(null)
    expect(resp).not.toBeNull()
    expect(resp!.status).toBe(401)
    const body = await resp!.json()
    expect(body).toEqual({ error: 'unauthorized' })
    expect(resolveIsAdmin).not.toHaveBeenCalled()
  })

  it('returns 401 { error: "unauthorized" } when session has no user.id', async () => {
    const session = { user: { email: 'x@y.com' }, expires: '2099-12-31' } as unknown as Session
    const resp = await requireAdminApi(session)
    expect(resp).not.toBeNull()
    expect(resp!.status).toBe(401)
    const body = await resp!.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })

  it('returns 404 { error: "not_found" } when user is authed but not an admin', async () => {
    resolveIsAdmin.mockResolvedValue(false)
    const resp = await requireAdminApi(makeSession('u4'))
    expect(resp).not.toBeNull()
    expect(resp!.status).toBe(404)
    const body = await resp!.json()
    expect(body).toEqual({ error: 'not_found' })
    expect(resolveIsAdmin).toHaveBeenCalledWith('u4')
  })

  it('sets Content-Type: application/json on error responses', async () => {
    const resp = await requireAdminApi(null)
    expect(resp!.headers.get('Content-Type')).toBe('application/json')
  })
})
