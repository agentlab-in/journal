import { describe, it, expect } from 'vitest'
import { slug, SLUG_STOPWORDS } from '@/lib/posts/slug'

describe('slug()', () => {
  it('lowercases and kebab-cases basic input', () => {
    expect(slug('Hello, World!')).toBe('hello-world')
  })

  it('ASCII-folds unicode characters', () => {
    expect(slug('Café Olé')).toBe('cafe-ole')
  })

  it('strips a basic English stopword list', () => {
    expect(slug('A Tale of Two Cities')).toBe('tale-two-cities')
    expect(slug('The quick brown fox')).toBe('quick-brown-fox')
    expect(slug('On the road to nowhere')).toBe('road-nowhere')
  })

  it('preserves stopwords when stripping would leave the slug empty', () => {
    expect(slug('The')).toBe('the')
    expect(slug('a an the')).toBe('a-an-the')
    expect(slug('Of')).toBe('of')
  })

  it('case-folds stopwords before comparison', () => {
    expect(slug('THE QUICK BROWN FOX')).toBe('quick-brown-fox')
    expect(slug('Is It This')).toBe('is-it-this')
  })

  it('truncates long titles to 80 chars on a word boundary', () => {
    const longTitle =
      'this title contains many descriptive words that should be truncated when they exceed the limit of eighty characters total'
    const result = slug(longTitle)
    expect(result.length).toBeLessThanOrEqual(80)
    expect(result.endsWith('-')).toBe(false)
    expect(result.startsWith('-')).toBe(false)
    expect(result.split('-').every((word) => word.length > 0)).toBe(true)
  })

  it('truncates without leaving a trailing hyphen', () => {
    const title = 'a'.repeat(40) + ' ' + 'b'.repeat(50)
    const result = slug(title)
    expect(result.length).toBeLessThanOrEqual(80)
    expect(result.endsWith('-')).toBe(false)
  })

  it('returns empty string for whitespace-only input', () => {
    expect(slug('   ')).toBe('')
    expect(slug('')).toBe('')
    expect(slug('\t\n  ')).toBe('')
  })

  it('strips emoji', () => {
    expect(slug('Hello 👋 World 🌍')).toBe('hello-world')
    expect(slug('🚀 launch day')).toBe('launch-day')
  })

  it('collapses multiple whitespace into a single hyphen', () => {
    expect(slug('hello    world')).toBe('hello-world')
    expect(slug('hello\t\nworld')).toBe('hello-world')
  })

  it('removes leading and trailing hyphens', () => {
    expect(slug('---hello world---')).toBe('hello-world')
    expect(slug('!!!hello world!!!')).toBe('hello-world')
  })

  it('removes punctuation', () => {
    expect(slug("don't stop believing")).toBe('don-t-stop-believing')
    expect(slug('hello: world; foo, bar.')).toBe('hello-world-foo-bar')
  })

  it('preserves numerals', () => {
    expect(slug('2026 review')).toBe('2026-review')
    expect(slug('top 10 things')).toBe('top-10-things')
  })

  it('handles very long inputs without crashing', () => {
    const huge = 'word '.repeat(10_000)
    const result = slug(huge)
    expect(result.length).toBeLessThanOrEqual(80)
    expect(result).not.toBe('')
  })

  it('exports SLUG_STOPWORDS with the spec stopword list', () => {
    const expected = [
      'a',
      'an',
      'the',
      'and',
      'or',
      'of',
      'to',
      'in',
      'for',
      'with',
      'on',
      'at',
      'by',
      'is',
      'it',
      'this',
      'that',
      'these',
      'those',
    ]
    for (const word of expected) {
      expect(SLUG_STOPWORDS.has(word)).toBe(true)
    }
  })
})
