import { describe, it, expect } from 'vitest'
import { decideBanRedirect } from '@/lib/auth'

describe('decideBanRedirect()', () => {
  it('returns null when banned_at is null (not banned)', () => {
    const result = decideBanRedirect({ login: 'someuser', banned_at: null })
    expect(result).toBeNull()
  })

  it('returns the blocked redirect with login appended for a valid GitHub handle', () => {
    const result = decideBanRedirect({
      login: 'validuser',
      banned_at: '2026-05-30T10:00:00.000Z',
    })
    expect(result).toBe('/auth/blocked?reason=banned&login=validuser')
  })

  it('lowercases the login in the redirect URL', () => {
    const result = decideBanRedirect({
      login: 'ValidUser',
      banned_at: '2026-05-30T10:00:00.000Z',
    })
    expect(result).toBe('/auth/blocked?reason=banned&login=validuser')
  })

  it('omits the login when the value contains invalid characters (defense-in-depth)', () => {
    const result = decideBanRedirect({
      login: '<script>alert(1)</script>',
      banned_at: '2026-05-30T10:00:00.000Z',
    })
    expect(result).toBe('/auth/blocked?reason=banned')
  })

  it('omits the login when the login is an empty string', () => {
    const result = decideBanRedirect({
      login: '',
      banned_at: '2026-05-30T10:00:00.000Z',
    })
    expect(result).toBe('/auth/blocked?reason=banned')
  })
})
