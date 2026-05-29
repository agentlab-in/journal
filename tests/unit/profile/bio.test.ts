import { describe, it, expect } from 'vitest'
import { bioToPlainText } from '@/lib/profile/bio'

describe('bioToPlainText', () => {
  it('returns short bios unchanged', () => {
    expect(bioToPlainText('Hello world')).toBe('Hello world')
  })

  it('strips markdown emphasis and headings', () => {
    expect(bioToPlainText('# Title\n**bold** and _italic_ text')).toBe(
      'Title bold and italic text',
    )
  })

  it('replaces links with their visible text', () => {
    expect(bioToPlainText('See [my site](https://example.com)')).toBe('See my site')
  })

  it('drops code fences', () => {
    expect(bioToPlainText('Intro\n```ts\nconst x = 1\n```\nOutro')).toBe(
      'Intro Outro',
    )
  })

  it('truncates with ellipsis past the max length', () => {
    const longText = 'a'.repeat(200)
    const out = bioToPlainText(longText, 50)
    expect(out.length).toBe(50)
    expect(out.endsWith('…')).toBe(true)
  })

  it('collapses runs of whitespace', () => {
    expect(bioToPlainText('foo\n\n\n   bar')).toBe('foo bar')
  })
})
