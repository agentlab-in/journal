import { describe, it, expect } from 'vitest'
import { getViewerTagAffinity } from '@/lib/feed/affinity'

// Pin "now" so the exponential recency weight is deterministic.
const NOW = new Date('2026-05-30T12:00:00.000Z')

function daysAgo(d: number): string {
  return new Date(NOW.getTime() - d * 86_400_000).toISOString()
}

/**
 * Minimal Supabase chain stub.
 *
 * `getViewerTagAffinity` builds three independent chains off
 * `db.from(table)`, so we route each by table name to a pre-canned response.
 * Each call to `.select / .eq / .order / .limit / .in` is chainable and a
 * no-op metadata-wise; the terminal `await` resolves to `{ data, error }`.
 */
type ChainResponse = { data: unknown; error: null | { message: string } }

function makeStub(responses: Record<string, ChainResponse | ChainResponse[]>) {
  // Per-table cursor so a table can be queried more than once (e.g. follows
  // → followed_ids, then posts authored by those users).
  const cursors: Record<string, number> = {}

  function chain(table: string) {
    const next = (): ChainResponse => {
      const r = responses[table]
      if (Array.isArray(r)) {
        const i = cursors[table] ?? 0
        cursors[table] = i + 1
        return r[i] ?? { data: [], error: null }
      }
      return r ?? { data: [], error: null }
    }

    const builder: {
      select: (...args: unknown[]) => typeof builder
      eq: (...args: unknown[]) => typeof builder
      in: (...args: unknown[]) => typeof builder
      order: (...args: unknown[]) => typeof builder
      limit: (...args: unknown[]) => typeof builder
      then: (
        onFulfilled: (value: ChainResponse) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise<unknown>
    } = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (onFulfilled, onRejected) =>
        Promise.resolve(next()).then(onFulfilled, onRejected),
    }
    return builder
  }

  return {
    from: (table: string) => chain(table),
  }
}

describe('getViewerTagAffinity', () => {
  it('returns an empty set when the viewer has no engagement signals', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = makeStub({}) as any
    const result = await getViewerTagAffinity(db, 'viewer-1', { now: NOW })
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it('weighs recent events higher than older events for the same tag', async () => {
    // Tag "old-favorite" was liked 60 days ago. Tag "new-favorite" was liked
    // 1 day ago. The viewer should end up biased toward the recent one.
    const db = makeStub({
      likes: {
        data: [
          {
            created_at: daysAgo(1),
            posts: {
              post_tags: [
                { tag_slug: 'new-favorite', tags: { slug: 'new-favorite', is_approved: true } },
              ],
            },
          },
          {
            created_at: daysAgo(60),
            posts: {
              post_tags: [
                { tag_slug: 'old-favorite', tags: { slug: 'old-favorite', is_approved: true } },
              ],
            },
          },
        ],
        error: null,
      },
      bookmarks: { data: [], error: null },
      follows: { data: [], error: null },
      posts: { data: [], error: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    const result = await getViewerTagAffinity(db, 'viewer-1', {
      now: NOW,
      limit: 1,
    })
    expect(result.size).toBe(1)
    expect(result.has('new-favorite')).toBe(true)
    expect(result.has('old-favorite')).toBe(false)
  })

  it('caps the result to `limit` tag slugs (default 8)', async () => {
    // Twelve distinct tags, all liked today — well above the default limit.
    const likes = Array.from({ length: 12 }, (_, i) => ({
      created_at: daysAgo(0),
      posts: {
        post_tags: [
          {
            tag_slug: `tag-${i}`,
            tags: { slug: `tag-${i}`, is_approved: true },
          },
        ],
      },
    }))

    const db = makeStub({
      likes: { data: likes, error: null },
      bookmarks: { data: [], error: null },
      follows: { data: [], error: null },
      posts: { data: [], error: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    const def = await getViewerTagAffinity(db, 'viewer-1', { now: NOW })
    expect(def.size).toBe(8)

    const three = await getViewerTagAffinity(db, 'viewer-1', {
      now: NOW,
      limit: 3,
    })
    expect(three.size).toBe(3)
  })

  it('filters out tags whose tags.is_approved is false', async () => {
    const db = makeStub({
      likes: {
        data: [
          {
            created_at: daysAgo(0),
            posts: {
              post_tags: [
                // approved → included
                { tag_slug: 'approved-tag', tags: { slug: 'approved-tag', is_approved: true } },
                // unapproved → dropped, even though it's a very recent like
                {
                  tag_slug: 'unapproved-tag',
                  tags: { slug: 'unapproved-tag', is_approved: false },
                },
              ],
            },
          },
        ],
        error: null,
      },
      bookmarks: { data: [], error: null },
      follows: { data: [], error: null },
      posts: { data: [], error: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    const result = await getViewerTagAffinity(db, 'viewer-1', { now: NOW })
    expect(result.has('approved-tag')).toBe(true)
    expect(result.has('unapproved-tag')).toBe(false)
  })

  it('aggregates weights across likes, bookmarks, and follows', async () => {
    // The viewer has three signals on three different tags:
    //   - 'liked' tag came from a like 1 day ago
    //   - 'bookmarked' tag came from a bookmark 1 day ago
    //   - 'followed-author' tag came from a post by someone they follow,
    //     published 1 day ago
    // All three sources should be represented in the resulting set.
    const db = makeStub({
      likes: {
        data: [
          {
            created_at: daysAgo(1),
            posts: {
              post_tags: [{ tag_slug: 'liked', tags: { slug: 'liked', is_approved: true } }],
            },
          },
        ],
        error: null,
      },
      bookmarks: {
        data: [
          {
            created_at: daysAgo(1),
            posts: {
              post_tags: [
                { tag_slug: 'bookmarked', tags: { slug: 'bookmarked', is_approved: true } },
              ],
            },
          },
        ],
        error: null,
      },
      follows: {
        data: [{ followed_id: 'author-a' }, { followed_id: 'author-b' }],
        error: null,
      },
      posts: {
        data: [
          {
            published_at: daysAgo(1),
            post_tags: [
              {
                tag_slug: 'followed-author',
                tags: { slug: 'followed-author', is_approved: true },
              },
            ],
          },
        ],
        error: null,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    const result = await getViewerTagAffinity(db, 'viewer-1', { now: NOW })
    expect(result.has('liked')).toBe(true)
    expect(result.has('bookmarked')).toBe(true)
    expect(result.has('followed-author')).toBe(true)
  })

  it('returns an empty set when the viewer has no follows (no posts query)', async () => {
    // Sanity check: when follows returns [], we don't blow up trying to
    // build a posts-by-author query with an empty IN list.
    const db = makeStub({
      likes: { data: [], error: null },
      bookmarks: { data: [], error: null },
      follows: { data: [], error: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    const result = await getViewerTagAffinity(db, 'viewer-1', { now: NOW })
    expect(result.size).toBe(0)
  })

  it('is robust to error responses (treats source as empty)', async () => {
    const db = makeStub({
      likes: { data: null, error: { message: 'boom' } },
      bookmarks: { data: null, error: { message: 'boom' } },
      follows: { data: null, error: { message: 'boom' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
    const result = await getViewerTagAffinity(db, 'viewer-1', { now: NOW })
    expect(result.size).toBe(0)
  })
})
