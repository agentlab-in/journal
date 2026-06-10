import { describe, it, expect, vi } from 'vitest'
import { getTrendingTags } from '@/lib/feed/trending-tags'

// ---------------------------------------------------------------------------
// Mock DB builder helpers
// ---------------------------------------------------------------------------

/**
 * Build a post_tags row fixture for the mock. Simulates the joined shape
 * returned by PostgREST when .select(...tags!inner..., posts!inner...) is used.
 */
function makeRow(tagSlug: string, tagName: string, publishedAt: string) {
  return {
    tag_slug: tagSlug,
    tags: { slug: tagSlug, name: tagName, is_approved: true },
    posts: { published_at: publishedAt, deleted_at: null },
  }
}

/**
 * Build a chainable Supabase stub that returns the given rows (or an error).
 */
function buildDb(
  rows: ReturnType<typeof makeRow>[],
  opts: { error?: boolean } = {},
) {
  let capturedGte: string | null = null

  const chain = {
    gte: vi.fn((col: string, val: string) => {
      if (col === 'posts.published_at') capturedGte = val
      return chain
    }),
    is: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: undefined as unknown,
  }

  // Make it "thenable" so await works — resolves like a Supabase response.
  const thenable = {
    ...chain,
    then(
      resolve: (v: { data: unknown; error: unknown }) => void,
    ) {
      resolve(
        opts.error
          ? { data: null, error: new Error('db error') }
          : { data: rows, error: null },
      )
    },
    getCapturedGte: () => capturedGte,
  }

  // Wire the chain to return the thenable at every step.
  chain.gte.mockReturnValue(thenable)
  chain.is.mockReturnValue(thenable)
  chain.eq.mockReturnValue(thenable)

  let selectChain = thenable

  const db = {
    from: vi.fn(() => ({
      select: vi.fn(() => {
        selectChain = thenable
        return selectChain
      }),
    })),
    _getGte: () => capturedGte,
  }

  return db
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getTrendingTags', () => {
  it('counts occurrences per tag_slug and sorts by count descending', async () => {
    const now = new Date('2026-06-01T00:00:00Z')
    const recent = new Date(now.getTime() - 3 * 86_400_000).toISOString()
    const rows = [
      makeRow('memory', 'Memory', recent),
      makeRow('evals', 'Evals', recent),
      makeRow('memory', 'Memory', recent),
      makeRow('memory', 'Memory', recent),
      makeRow('evals', 'Evals', recent),
    ]

    const db = buildDb(rows)
    const result = await getTrendingTags(db as never, 7, 5)

    expect(result[0].slug).toBe('memory')
    expect(result[0].count).toBe(3)
    expect(result[1].slug).toBe('evals')
    expect(result[1].count).toBe(2)
  })

  it('returns [] on DB error', async () => {
    const db = buildDb([], { error: true })
    const result = await getTrendingTags(db as never, 7, 5)
    expect(result).toEqual([])
  })

  it('respects the limit', async () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString()
    const rows = [
      makeRow('a', 'A', recent),
      makeRow('b', 'B', recent),
      makeRow('c', 'C', recent),
      makeRow('d', 'D', recent),
    ]
    const db = buildDb(rows)
    const result = await getTrendingTags(db as never, 7, 2)
    expect(result).toHaveLength(2)
  })

  it('passes the window cutoff as the .gte argument', async () => {
    const fakeNow = new Date('2026-06-01T12:00:00.000Z')
    const expectedSince = new Date(
      fakeNow.getTime() - 7 * 86_400_000,
    ).toISOString()

    const callSpy = vi.fn()
    const dbSpy = {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          const inner = {
            gte: callSpy.mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then(resolve: (v: { data: unknown; error: unknown }) => void) {
              resolve({ data: [], error: null })
            },
          }
          return inner
        }),
      })),
    }

    vi.useFakeTimers()
    vi.setSystemTime(fakeNow)
    await getTrendingTags(dbSpy as never, 7, 5)
    vi.useRealTimers()

    expect(callSpy).toHaveBeenCalledWith('posts.published_at', expectedSince)
  })
})
