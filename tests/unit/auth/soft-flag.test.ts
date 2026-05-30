import { describe, it, expect } from 'vitest'
import { deriveSignupFlags } from '@/lib/auth/soft-flag'

describe('deriveSignupFlags', () => {
  it('returns {} when no flags trip (rich profile)', () => {
    expect(
      deriveSignupFlags({
        bio: 'Hello world',
        email: 'me@example.com',
        followers: 50,
      }),
    ).toEqual({})
  })

  it('flips thin_profile when bio empty AND email unset AND followers < 2', () => {
    expect(
      deriveSignupFlags({ bio: null, email: null, followers: 0 }),
    ).toEqual({ thin_profile: true })
    expect(
      deriveSignupFlags({ bio: '', email: '', followers: 1 }),
    ).toEqual({ thin_profile: true })
    expect(
      deriveSignupFlags({ bio: '   ', email: null, followers: 0 }),
    ).toEqual({ thin_profile: true })
  })

  it('does NOT trip thin_profile when bio is non-empty', () => {
    expect(
      deriveSignupFlags({ bio: 'hi', email: null, followers: 0 }),
    ).toEqual({})
  })

  it('does NOT trip thin_profile when email is set', () => {
    expect(
      deriveSignupFlags({ bio: null, email: 'a@b.com', followers: 0 }),
    ).toEqual({})
  })

  it('does NOT trip thin_profile when followers >= 2', () => {
    expect(
      deriveSignupFlags({ bio: null, email: null, followers: 2 }),
    ).toEqual({})
    expect(
      deriveSignupFlags({ bio: null, email: null, followers: 100 }),
    ).toEqual({})
  })

  it('handles boundary: followers === 1 still trips when other conditions hold', () => {
    expect(
      deriveSignupFlags({ bio: '', email: '', followers: 1 }),
    ).toEqual({ thin_profile: true })
  })

  it('all three conditions must hold simultaneously to trip', () => {
    // bio empty, email set, followers low → no trip
    expect(
      deriveSignupFlags({ bio: '', email: 'me@x.com', followers: 0 }),
    ).toEqual({})
    // bio set, email empty, followers low → no trip
    expect(
      deriveSignupFlags({ bio: 'hi', email: null, followers: 0 }),
    ).toEqual({})
    // bio empty, email empty, followers high → no trip
    expect(
      deriveSignupFlags({ bio: null, email: null, followers: 10 }),
    ).toEqual({})
  })
})
