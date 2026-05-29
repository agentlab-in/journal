import { describe, it, expect } from 'vitest'
import { deriveAuditColumns } from '@/lib/auth'

const NOW = new Date('2026-05-29T00:00:00Z')

function daysAgo(days: number): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function profile(overrides: Partial<{
  login: string
  public_repos: number
  created_at: string
}> = {}) {
  return {
    login: 'OctoCat',
    public_repos: 7,
    created_at: daysAgo(365),
    ...overrides,
  }
}

describe('deriveAuditColumns()', () => {
  it('lowercases github_login', () => {
    const cols = deriveAuditColumns(profile({ login: 'HarshitSinghBhandari' }), NOW)
    expect(cols.github_login).toBe('harshitsinghbhandari')
  })

  it('passes through a single-case login unchanged', () => {
    const cols = deriveAuditColumns(profile({ login: 'octocat' }), NOW)
    expect(cols.github_login).toBe('octocat')
  })

  it('computes account age in whole days', () => {
    const cols = deriveAuditColumns(profile({ created_at: daysAgo(42) }), NOW)
    expect(cols.github_account_age_days_at_signup).toBe(42)
  })

  it('reports 0 days for an account created today', () => {
    const cols = deriveAuditColumns(profile({ created_at: NOW.toISOString() }), NOW)
    expect(cols.github_account_age_days_at_signup).toBe(0)
  })

  it('copies public_repos verbatim', () => {
    const cols = deriveAuditColumns(profile({ public_repos: 0 }), NOW)
    expect(cols.github_public_repo_count_at_signup).toBe(0)
  })

  it('returns NaN age for an unparseable created_at (caller guards)', () => {
    const cols = deriveAuditColumns(profile({ created_at: 'not-a-date' }), NOW)
    expect(Number.isNaN(cols.github_account_age_days_at_signup)).toBe(true)
  })

  it('returns exactly the three audit columns expected by the trigger', () => {
    const cols = deriveAuditColumns(profile(), NOW)
    expect(Object.keys(cols).sort()).toEqual([
      'github_account_age_days_at_signup',
      'github_login',
      'github_public_repo_count_at_signup',
    ])
  })
})
