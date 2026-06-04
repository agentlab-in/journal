import { describe, it, expect } from 'vitest'
import { sanitizeBio } from '@/lib/profile/sanitize-bio'

describe('sanitizeBio', () => {
  it('strips script tags but preserves their inner text', () => {
    expect(sanitizeBio('<script>alert(1)</script>hello')).toBe('alert(1)hello')
  })

  it('strips img tags with event handlers wholesale', () => {
    expect(sanitizeBio('hi <img src=x onerror=alert(1)> there')).toBe('hi  there')
  })

  it('strips iframe tags', () => {
    expect(sanitizeBio('<iframe src="evil"></iframe>x')).toBe('x')
  })

  it('strips tags with attributes', () => {
    expect(sanitizeBio('<a href="x" onclick="y()">link</a>')).toBe('link')
  })

  it('preserves markdown formatting characters', () => {
    expect(sanitizeBio('Building **agents** with [tools](https://example.com)')).toBe(
      'Building **agents** with [tools](https://example.com)',
    )
  })

  it('preserves newlines', () => {
    expect(sanitizeBio('line one\n\nline two')).toBe('line one\n\nline two')
  })

  it('leaves plain text untouched', () => {
    expect(sanitizeBio('hello world')).toBe('hello world')
  })

  it('returns an empty string for an empty input', () => {
    expect(sanitizeBio('')).toBe('')
  })
})
