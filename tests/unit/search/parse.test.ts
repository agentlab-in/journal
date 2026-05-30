import { describe, it, expect } from 'vitest'
import { parseSearchParams } from '@/lib/search/query'

describe('parseSearchParams — q', () => {
  it('defaults to empty string when missing', () => {
    expect(parseSearchParams({}).q).toBe('')
  })

  it('trims surrounding whitespace', () => {
    expect(parseSearchParams({ q: '  hello world  ' }).q).toBe('hello world')
  })

  it('uses the first value when q is repeated', () => {
    expect(parseSearchParams({ q: ['first', 'second'] }).q).toBe('first')
  })

  it('returns empty string for whitespace-only input (does not throw)', () => {
    expect(parseSearchParams({ q: '   ' }).q).toBe('')
  })
})

describe('parseSearchParams — type', () => {
  it('defaults to null (all types) when missing', () => {
    expect(parseSearchParams({}).type).toBeNull()
  })

  it('snaps garbage to null', () => {
    expect(parseSearchParams({ type: 'garbage' }).type).toBeNull()
    expect(parseSearchParams({ type: 'POST' }).type).toBeNull() // case-sensitive
    expect(parseSearchParams({ type: ' post ' }).type).toBeNull()
    expect(parseSearchParams({ type: '' }).type).toBeNull()
  })

  it('accepts post, playbook, dive verbatim', () => {
    expect(parseSearchParams({ type: 'post' }).type).toBe('post')
    expect(parseSearchParams({ type: 'playbook' }).type).toBe('playbook')
    expect(parseSearchParams({ type: 'dive' }).type).toBe('dive')
  })
})

describe('parseSearchParams — tag', () => {
  it('defaults to empty array when missing', () => {
    expect(parseSearchParams({}).tags).toEqual([])
  })

  it('wraps a single string tag into an array of one', () => {
    expect(parseSearchParams({ tag: 'security' }).tags).toEqual(['security'])
  })

  it('preserves multiple tags from repeated tag=foo&tag=bar', () => {
    expect(parseSearchParams({ tag: ['security', 'memory'] }).tags).toEqual([
      'security',
      'memory',
    ])
  })

  it('lowercases tag slugs', () => {
    expect(parseSearchParams({ tag: ['Security', 'MEMORY'] }).tags).toEqual([
      'security',
      'memory',
    ])
  })

  it('dedupes case-insensitively and trims', () => {
    expect(
      parseSearchParams({ tag: ['security', 'Security', '  security  ', 'memory'] }).tags,
    ).toEqual(['security', 'memory'])
  })

  it('drops empty/whitespace-only entries', () => {
    expect(parseSearchParams({ tag: ['', '   ', 'security'] }).tags).toEqual(['security'])
  })
})

describe('parseSearchParams — combined', () => {
  it('returns a fully populated parse for a realistic URL shape', () => {
    expect(
      parseSearchParams({
        q: 'rag eval',
        type: 'playbook',
        tag: ['evals', 'rag'],
      }),
    ).toEqual({ q: 'rag eval', type: 'playbook', tags: ['evals', 'rag'] })
  })
})
