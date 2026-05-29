import { describe, it, expect } from 'vitest'
import { evaluateGate } from '@/lib/auth'

// Fixed "now" so tests are deterministic
const NOW = new Date('2026-01-30T12:00:00Z')

function daysAgo(days: number): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

describe('evaluateGate()', () => {
  it('rejects an account that is under 30 days old', () => {
    const result = evaluateGate(
      { login: 'newuser', public_repos: 5, created_at: daysAgo(27) },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.redirect).toBe('/auth/blocked?reason=age_27_days&login=newuser')
    }
  })

  it('encodes the actual age in the reason (not 30)', () => {
    const result = evaluateGate(
      { login: 'newuser2', public_repos: 3, created_at: daysAgo(5) },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.redirect).toBe('/auth/blocked?reason=age_5_days&login=newuser2')
    }
  })

  it('rejects an account with no public repos', () => {
    const result = evaluateGate(
      { login: 'olduser', public_repos: 0, created_at: daysAgo(365) },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.redirect).toBe('/auth/blocked?reason=no_public_repos&login=olduser')
    }
  })

  it('rejects a reserved username before checking age or repos', () => {
    // admin is reserved; age and repos would otherwise be fine
    const result = evaluateGate(
      { login: 'admin', public_repos: 10, created_at: daysAgo(365) },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.redirect).toBe('/auth/blocked?reason=reserved_name&login=admin')
    }
  })

  it('allows a valid account (30+ days, 1+ repos, non-reserved login)', () => {
    const result = evaluateGate(
      { login: 'harshitsinghbhandari', public_repos: 42, created_at: daysAgo(365) },
      NOW,
    )
    expect(result.ok).toBe(true)
  })

  it('allows an account exactly 30 days old', () => {
    const result = evaluateGate(
      { login: 'validuser', public_repos: 1, created_at: daysAgo(30) },
      NOW,
    )
    expect(result.ok).toBe(true)
  })

  it('reserved check is case-insensitive', () => {
    const result = evaluateGate(
      { login: 'ADMIN', public_repos: 10, created_at: daysAgo(365) },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Login is lowercased before being appended.
      expect(result.redirect).toBe('/auth/blocked?reason=reserved_name&login=admin')
    }
  })

  it('rejects a malformed created_at instead of silently allowing (NaN bypass guard)', () => {
    const result = evaluateGate(
      { login: 'newuser', public_repos: 5, created_at: 'not-a-date' },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.redirect).toBe(
        '/auth/blocked?reason=invalid_account_data&login=newuser',
      )
    }
  })

  it('omits login from the redirect when the value is not a valid GitHub handle', () => {
    // A hostile / malformed login (e.g. injected from an exploit) should
    // never make it into the redirect URL.
    const result = evaluateGate(
      { login: '<script>alert(1)</script>', public_repos: 5, created_at: daysAgo(5) },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.redirect).toBe('/auth/blocked?reason=age_5_days')
    }
  })
})
