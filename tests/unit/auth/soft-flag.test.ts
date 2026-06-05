import { describe, it, expect } from 'vitest'
import { deriveSignupFlags, type SoftFlagInput, type SoftFlagOutput } from '@/lib/auth/soft-flag'

// Fixed "now" so account-age cases are deterministic across CI clocks.
const NOW = new Date('2026-06-01T00:00:00Z')

const RICH_PROFILE: SoftFlagInput = {
  bio: 'Senior platform engineer at Acme. Building AI infra.',
  email: 'engineer@example.com',
  followers: 200,
  following: 150,
  publicRepos: 42,
  // ~5 years before NOW → comfortably above the 90-day young-account gate.
  createdAt: '2021-05-12T00:00:00Z',
}

function profile(overrides: Partial<SoftFlagInput>): SoftFlagInput {
  return { ...RICH_PROFILE, ...overrides }
}

describe('deriveSignupFlags — rich profile baseline', () => {
  it('returns {} for a fully populated established account', () => {
    expect(deriveSignupFlags(RICH_PROFILE, NOW)).toEqual({})
  })
})

describe('deriveSignupFlags — legacy thin_profile signal (backward compat)', () => {
  // thin_profile must continue to fire only when bio empty + email unset +
  // followers < 2, so historical rows remain comparable.
  const cases: Array<[string, Partial<SoftFlagInput>, boolean]> = [
    ['null bio + null email + 0 followers', { bio: null, email: null, followers: 0 }, true],
    ['empty-string bio + empty email + 1 follower', { bio: '', email: '', followers: 1 }, true],
    ['whitespace bio + null email + 0 followers', { bio: '   ', email: null, followers: 0 }, true],
    ['bio set, email unset, low followers', { bio: 'hi', email: null, followers: 0 }, false],
    ['bio empty, email set, low followers', { bio: '', email: 'a@b.com', followers: 0 }, false],
    ['bio empty, email empty, 2 followers', { bio: '', email: '', followers: 2 }, false],
  ]

  for (const [label, override, shouldTrip] of cases) {
    it(`${shouldTrip ? 'trips' : 'omits'} thin_profile when ${label}`, () => {
      const out = deriveSignupFlags(profile(override), NOW)
      expect(out.thin_profile === true).toBe(shouldTrip)
    })
  }
})

describe('deriveSignupFlags — young_account', () => {
  const cases: Array<[string, string, boolean]> = [
    ['1 day old', '2026-05-31T00:00:00Z', true],
    ['exactly at 90-day threshold', '2026-03-03T00:00:00Z', false],
    ['89 days old', '2026-03-04T00:00:00Z', true],
    ['1 year old', '2025-06-01T00:00:00Z', false],
  ]

  for (const [label, createdAt, shouldTrip] of cases) {
    it(`${shouldTrip ? 'flags' : 'omits'} young_account when account is ${label}`, () => {
      const out = deriveSignupFlags(profile({ createdAt }), NOW)
      expect(out.young_account === true).toBe(shouldTrip)
    })
  }

  it('omits young_account when createdAt is null (unknown)', () => {
    const out = deriveSignupFlags(profile({ createdAt: null }), NOW)
    expect(out.young_account).toBeUndefined()
  })

  it('omits young_account when createdAt is malformed', () => {
    const out = deriveSignupFlags(profile({ createdAt: 'not-a-date' }), NOW)
    expect(out.young_account).toBeUndefined()
  })

  it('omits young_account when createdAt is in the future (clock skew)', () => {
    const out = deriveSignupFlags(profile({ createdAt: '2030-01-01T00:00:00Z' }), NOW)
    expect(out.young_account).toBeUndefined()
  })
})

describe('deriveSignupFlags — low_repos / low_followers / low_following', () => {
  const cases: Array<[keyof SoftFlagOutput, Partial<SoftFlagInput>, boolean]> = [
    ['low_repos', { publicRepos: 0 }, true],
    ['low_repos', { publicRepos: 2 }, true],
    ['low_repos', { publicRepos: 3 }, false],
    ['low_repos', { publicRepos: 99 }, false],
    ['low_followers', { followers: 0 }, true],
    ['low_followers', { followers: 1 }, true],
    ['low_followers', { followers: 2 }, false],
    ['low_followers', { followers: 50 }, false],
    ['low_following', { following: 0 }, true],
    ['low_following', { following: 1 }, true],
    ['low_following', { following: 2 }, false],
    ['low_following', { following: 50 }, false],
  ]

  for (const [flag, override, shouldTrip] of cases) {
    const valueLabel = Object.entries(override).map(([k, v]) => `${k}=${v}`).join(', ')
    it(`${shouldTrip ? 'flags' : 'omits'} ${flag} when ${valueLabel}`, () => {
      const out = deriveSignupFlags(profile(override), NOW)
      expect(out[flag] === true).toBe(shouldTrip)
    })
  }
})

describe('deriveSignupFlags — bio quality signals', () => {
  const cases: Array<[string, string | null, { empty?: boolean; short?: boolean }]> = [
    ['null bio', null, { empty: true }],
    ['empty bio', '', { empty: true }],
    ['whitespace bio', '   ', { empty: true }],
    ['1-char bio', 'a', { short: true }],
    ['7-char bio', '1234567', { short: true }],
    ['8-char bio (threshold)', '12345678', {}],
    ['rich bio', 'Senior engineer at Acme', {}],
  ]

  for (const [label, bio, expected] of cases) {
    it(`bio="${label}" → empty_bio=${!!expected.empty}, short_bio=${!!expected.short}`, () => {
      const out = deriveSignupFlags(profile({ bio }), NOW)
      expect(out.empty_bio === true).toBe(!!expected.empty)
      expect(out.short_bio === true).toBe(!!expected.short)
    })
  }

  it('empty_bio and short_bio are mutually exclusive', () => {
    const empty = deriveSignupFlags(profile({ bio: '' }), NOW)
    const short = deriveSignupFlags(profile({ bio: 'hi' }), NOW)
    expect(empty.empty_bio).toBe(true)
    expect(empty.short_bio).toBeUndefined()
    expect(short.empty_bio).toBeUndefined()
    expect(short.short_bio).toBe(true)
  })
})

describe('deriveSignupFlags — no_public_email', () => {
  const cases: Array<[string, string | null, boolean]> = [
    ['null', null, true],
    ['empty', '', true],
    ['whitespace', '   ', true],
    ['present', 'me@example.com', false],
  ]

  for (const [label, email, shouldTrip] of cases) {
    it(`${shouldTrip ? 'flags' : 'omits'} no_public_email when email is ${label}`, () => {
      const out = deriveSignupFlags(profile({ email }), NOW)
      expect(out.no_public_email === true).toBe(shouldTrip)
    })
  }
})

describe('deriveSignupFlags — combined / real-world shapes', () => {
  it('flags a freshly-minted bot that defeats the legacy single-flag heuristic', () => {
    // 2 followers + non-empty bio defeats the legacy thin_profile gate
    // but should now light up young_account + low_repos + low_following.
    const out = deriveSignupFlags(
      profile({
        bio: 'AI enthusiast',
        email: 'bot@throwaway.example',
        followers: 2,
        following: 0,
        publicRepos: 0,
        createdAt: '2026-05-25T00:00:00Z', // 7 days old
      }),
      NOW,
    )
    expect(out.thin_profile).toBeUndefined()
    expect(out.young_account).toBe(true)
    expect(out.low_repos).toBe(true)
    expect(out.low_following).toBe(true)
    expect(out.low_followers).toBeUndefined()
  })

  it('stacks legacy thin_profile alongside new granular signals', () => {
    const out = deriveSignupFlags(
      profile({
        bio: null,
        email: null,
        followers: 0,
        following: 0,
        publicRepos: 0,
        createdAt: '2026-05-25T00:00:00Z',
      }),
      NOW,
    )
    expect(out.thin_profile).toBe(true)
    expect(out.empty_bio).toBe(true)
    expect(out.no_public_email).toBe(true)
    expect(out.low_followers).toBe(true)
    expect(out.low_following).toBe(true)
    expect(out.low_repos).toBe(true)
    expect(out.young_account).toBe(true)
  })
})
