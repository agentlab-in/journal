import { describe, it, expect, vi } from 'vitest'
import { findUniqueSlug } from '@/lib/posts/slug-collision'

function mockDbWithTakenSlugs(taken: string[]) {
  const set = new Set(taken)
  const inFn = vi.fn((_col: string, vals: string[]) =>
    Promise.resolve({
      data: vals.filter((v) => set.has(v)).map((slug) => ({ slug })),
      error: null,
    }),
  )
  const eqFn = vi.fn(() => ({ in: inFn }))
  const selectFn = vi.fn(() => ({ eq: eqFn }))
  return { from: vi.fn(() => ({ select: selectFn })) }
}

describe('findUniqueSlug', () => {
  it('returns base when nothing taken', async () => {
    const db = mockDbWithTakenSlugs([])
    expect(await findUniqueSlug(db as never, 'author-1', 'hello')).toBe('hello')
  })
  it('suffixes -2 when base taken', async () => {
    const db = mockDbWithTakenSlugs(['hello'])
    expect(await findUniqueSlug(db as never, 'author-1', 'hello')).toBe('hello-2')
  })
  it('skips up to first free suffix', async () => {
    const db = mockDbWithTakenSlugs(['hello', 'hello-2', 'hello-3'])
    expect(await findUniqueSlug(db as never, 'author-1', 'hello')).toBe('hello-4')
  })
  it('throws after exhausting 99 suffixes', async () => {
    const taken = ['hello', ...Array.from({ length: 98 }, (_, i) => `hello-${i + 2}`)]
    const db = mockDbWithTakenSlugs(taken)
    await expect(findUniqueSlug(db as never, 'a', 'hello')).rejects.toThrow(/exhausted/i)
  })
})
