import { describe, it, expect } from 'vitest'
import { extractWikilinkAnchors } from '@/lib/posts/wikilinks-extract'

describe('extractWikilinkAnchors', () => {
  it('returns [] for empty / no-link bodies', () => {
    expect(extractWikilinkAnchors('')).toEqual([])
    expect(extractWikilinkAnchors('plain text')).toEqual([])
  })
  it('extracts single anchor text', () => {
    expect(extractWikilinkAnchors('see [[Pattern Name]] for context')).toEqual([
      'Pattern Name',
    ])
  })
  it('uses the lookup portion of alias syntax', () => {
    expect(
      extractWikilinkAnchors('see [[Pattern Name|the original pattern]]'),
    ).toEqual(['Pattern Name'])
  })
  it('dedupes case-insensitively, keeping first occurrence casing', () => {
    expect(
      extractWikilinkAnchors('[[A]] then [[a]] then [[A]] then [[B]]'),
    ).toEqual(['A', 'B'])
  })
  it('ignores anchors inside fenced code blocks', () => {
    const body = '```\n[[NotAnAnchor]]\n```\n[[Real Anchor]]'
    expect(extractWikilinkAnchors(body)).toEqual(['Real Anchor'])
  })
  it('ignores anchors inside inline code', () => {
    expect(extractWikilinkAnchors('`[[code]]` and [[real]]')).toEqual(['real'])
  })
})
