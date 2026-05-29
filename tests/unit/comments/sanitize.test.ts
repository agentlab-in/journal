import { describe, it, expect } from 'vitest'
import { sanitizeCommentBody } from '@/lib/comments/sanitize'

describe('sanitizeCommentBody', () => {
  it('strips script tags and their content tags', () => {
    expect(sanitizeCommentBody('<script>alert(1)</script>hi')).toBe('alert(1)hi')
  })

  it('strips inline formatting tags', () => {
    expect(sanitizeCommentBody('<b>x</b>')).toBe('x')
  })

  it('leaves plain text untouched', () => {
    expect(sanitizeCommentBody('hello')).toBe('hello')
  })

  it('preserves newlines between paragraphs', () => {
    expect(sanitizeCommentBody('a\n\nb')).toBe('a\n\nb')
  })

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeCommentBody('   hello   ')).toBe('hello')
  })

  it('strips multiple tags in one string', () => {
    expect(sanitizeCommentBody('<p>one</p><p>two</p>')).toBe('onetwo')
  })

  it('strips tags with attributes', () => {
    expect(sanitizeCommentBody('<a href="x" onclick="y()">link</a>')).toBe('link')
  })

  it('collapses runs of spaces and tabs but preserves newlines', () => {
    expect(sanitizeCommentBody('a    b\nc')).toBe('a b\nc')
  })
})
