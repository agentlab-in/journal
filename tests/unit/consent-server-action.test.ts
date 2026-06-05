import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Map<string, string>([
    ['x-forwarded-for', '203.0.113.5'],
    ['user-agent', 'vitest/1.0'],
  ]),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ user: { id: 'uid-1' } })),
}))

const insertSpy = vi.fn()
const sessionsDeleteSpy = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => {
        insertSpy(table, row)
        return Promise.resolve({ data: row, error: null })
      },
    }),
    schema: (s: string) => ({
      from: (table: string) => ({
        delete: () => ({
          eq: (col: string, val: string) => {
            sessionsDeleteSpy(s, table, col, val)
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }),
  }),
}))

beforeEach(() => {
  insertSpy.mockClear()
  sessionsDeleteSpy.mockClear()
})

describe('recordConsent', () => {
  it('rejects when age is not confirmed', async () => {
    const { recordConsent } = await import('@/lib/consent/server-actions')
    const fd = new FormData()
    fd.set('age', 'false')
    fd.set('terms', 'true')
    fd.set('content_policy', 'true')
    fd.set('privacy_policy', 'true')
    await expect(recordConsent(fd)).rejects.toThrow(/REDIRECT:\/auth\/consent\?error=/)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects when terms is not confirmed', async () => {
    const { recordConsent } = await import('@/lib/consent/server-actions')
    const fd = new FormData()
    fd.set('age', 'true')
    fd.set('terms', 'false')
    fd.set('content_policy', 'true')
    fd.set('privacy_policy', 'true')
    await expect(recordConsent(fd)).rejects.toThrow(/REDIRECT:\/auth\/consent\?error=/)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('inserts a consent row with current versions when all 4 are ticked', async () => {
    const { recordConsent } = await import('@/lib/consent/server-actions')
    const fd = new FormData()
    fd.set('age', 'true')
    fd.set('terms', 'true')
    fd.set('content_policy', 'true')
    fd.set('privacy_policy', 'true')
    await expect(recordConsent(fd)).rejects.toThrow(/REDIRECT:\//)
    expect(insertSpy).toHaveBeenCalledOnce()
    const [table, row] = insertSpy.mock.calls[0]
    expect(table).toBe('consents')
    expect(row).toMatchObject({
      user_id: 'uid-1',
      age_confirmed: true,
      terms_version: expect.any(String),
      content_policy_version: expect.any(String),
      privacy_policy_version: expect.any(String),
      ip_address: '203.0.113.5',
      user_agent: 'vitest/1.0',
    })
  })
})

describe('declineConsent', () => {
  it('deletes sessions before deleting the user', async () => {
    const { declineConsent } = await import('@/lib/consent/server-actions')
    await expect(declineConsent()).rejects.toThrow(/REDIRECT:\/auth\/consent-declined/)

    // Find first 'sessions' call and first 'users' call; assert ordering.
    const calls = sessionsDeleteSpy.mock.calls
    const orders = sessionsDeleteSpy.mock.invocationCallOrder
    const sessionsIdx = calls.findIndex((c) => c[1] === 'sessions')
    const usersIdx = calls.findIndex((c) => c[1] === 'users')
    expect(sessionsIdx).toBeGreaterThanOrEqual(0)
    expect(usersIdx).toBeGreaterThanOrEqual(0)
    expect(orders[sessionsIdx] < orders[usersIdx]).toBe(true)
  })
})
