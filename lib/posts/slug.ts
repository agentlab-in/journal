import { transliterate } from 'transliteration'

export const SLUG_STOPWORDS: ReadonlySet<string> = new Set([
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
])

const MAX_LEN = 80

export function slug(input: string): string {
  const folded = transliterate(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (folded === '') return ''

  const words = folded.split('-')
  const filtered = words.filter((w) => w.length > 0 && !SLUG_STOPWORDS.has(w))
  const kept = filtered.length > 0 ? filtered : words

  let length = 0
  const truncated: string[] = []
  for (const word of kept) {
    const next = truncated.length === 0 ? word.length : length + 1 + word.length
    if (next > MAX_LEN) break
    truncated.push(word)
    length = next
  }

  if (truncated.length === 0) {
    return kept[0].slice(0, MAX_LEN).replace(/-+$/g, '')
  }

  return truncated.join('-')
}
