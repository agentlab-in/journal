import { describe, it, expect } from 'vitest'
import {
  HONEYPOT_FIELD,
  isHoneypotTripped,
  isUrlHeavy,
} from '@/lib/comments/abuse'

describe('HONEYPOT_FIELD', () => {
  it('is the literal "_h"', () => {
    expect(HONEYPOT_FIELD).toBe('_h')
  })
})

describe('isHoneypotTripped', () => {
  it('returns false for non-object bodies', () => {
    expect(isHoneypotTripped(null)).toBe(false)
    expect(isHoneypotTripped(undefined)).toBe(false)
    expect(isHoneypotTripped('string')).toBe(false)
    expect(isHoneypotTripped(42)).toBe(false)
  })

  it('returns false when _h is absent', () => {
    expect(isHoneypotTripped({})).toBe(false)
    expect(isHoneypotTripped({ body: 'comment' })).toBe(false)
  })

  it('returns false when _h is empty string', () => {
    expect(isHoneypotTripped({ _h: '' })).toBe(false)
  })

  it('returns false when _h is null or undefined', () => {
    expect(isHoneypotTripped({ _h: null })).toBe(false)
    expect(isHoneypotTripped({ _h: undefined })).toBe(false)
  })

  it('returns true when _h has any non-empty string', () => {
    expect(isHoneypotTripped({ _h: 'spam' })).toBe(true)
    expect(isHoneypotTripped({ _h: ' ' })).toBe(true)
  })

  it('returns true when _h is a non-empty array', () => {
    expect(isHoneypotTripped({ _h: ['x'] })).toBe(true)
    expect(isHoneypotTripped({ _h: [] })).toBe(false)
  })

  it('returns true when _h is a non-zero number or true boolean', () => {
    expect(isHoneypotTripped({ _h: 1 })).toBe(true)
    expect(isHoneypotTripped({ _h: 0 })).toBe(false)
    expect(isHoneypotTripped({ _h: true })).toBe(true)
    expect(isHoneypotTripped({ _h: false })).toBe(false)
  })

  it('returns true when _h is a non-empty object', () => {
    expect(isHoneypotTripped({ _h: { a: 1 } })).toBe(true)
    expect(isHoneypotTripped({ _h: {} })).toBe(false)
  })
})

describe('isUrlHeavy', () => {
  it('returns false for empty/whitespace input', () => {
    expect(isUrlHeavy('')).toBe(false)
    expect(isUrlHeavy('   ')).toBe(false)
  })

  it('returns false for non-url text', () => {
    expect(isUrlHeavy('this is a normal comment with no links')).toBe(false)
  })

  it('returns false when URLs are <= 50% of tokens', () => {
    // 1 url out of 4 tokens = 25%
    expect(isUrlHeavy('check this https://example.com cool right')).toBe(false)
  })

  it('returns true when URLs exceed 50% of tokens', () => {
    // 3 urls out of 4 tokens = 75%
    expect(
      isUrlHeavy('https://a.com https://b.com https://c.com hi'),
    ).toBe(true)
  })

  it('counts www.* tokens as URLs', () => {
    // 2 urls out of 3 tokens = 66%
    expect(isUrlHeavy('www.a.com www.b.com text')).toBe(true)
  })

  it('counts scheme-only :// tokens as URLs', () => {
    // 2 urls (custom://, ftp://x) out of 3 tokens
    expect(isUrlHeavy('custom://a ftp://x.com text')).toBe(true)
  })

  it('treats single-url comments (1/1) as URL-heavy', () => {
    expect(isUrlHeavy('https://only.example.com')).toBe(true)
  })
})
