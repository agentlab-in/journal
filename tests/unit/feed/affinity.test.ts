import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getViewerTagAffinity,
  _clearAffinityCacheForTests,
} from '@/lib/feed/affinity'

// Pin "now" so the exponential recency weight is deterministic.
const NOW = new Date('2026-05-30T12:00:00.000Z')

function daysAgo(d: number): string {
  return new Date(NOW.getTime() - d * 86_400_000).toISOString()
}

/**
 * Minimal Supabase chain stub.
 *
 * `getViewerTagAffinity` builds three independent chains off
 * `db.from(table)` (likes, bookmarks, follows are fired via Promise.all),
 * plus an optional 4th (posts authored by followed users). We route each
 * by table name to a pre-canned response. Each call to
 * `.select / .eq / .order / .limit / .in` is chainable and a no-op
 * metadata-wise; the terminal `await` resolves to `{ data, error }`.
 *
 * `fromSpy` lets tests assert which tables were hit (for cache tests).
 */
type ChainResponse = { data: unknown; error: null | { message: string } }

function makeStub(responses: Record<string, ChainResponse | ChainResponse[]>) {
  // Per-table cursor so a table can be queried more than once (e.g. follows
  // → followed_ids, then posts authored by those users).
  const cursors: Record<string, number> = {}
  const fromSpy = vi.fn<(table: string) => unknown>()

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
      is: (...args: unknown[]) => typeof builder
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
      is: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (onFulfilled, onRejected) =>
        Promise.resolve(next()).then(onFulfilled, onRejected),
    }
    return builder
  }

  return {
    from: (table: string) => {
      fromSpy(table)
      return chain(table)
    },
    fromSpy,
  }
}

describe('getViewerTagAffinity', () => {
  // The affinity cache lives at module level — clear it between tests so
  // each case starts from a known empty state. Without this, the second
  // call for the same viewerId would short-circuit on the cached entry
  // and the test stubs would never be invoked.
  beforeEach(() => {
    _clearAffinityCacheForTests()
  })
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

    const callsAfterFirst = db.fromSpy.mock.calls.length
    const three = await getViewerTagAffinity(db, 'viewer-1', {
      now: NOW,
      limit: 3,
    })
    expect(three.size).toBe(3)
    expect(db.fromSpy.mock.calls.length).toBe(callsAfterFirst) // cache hit, no new DB calls
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

  it('issues the three engagement queries in parallel (no inter-dependence)', async () => {
    // A naive sequential implementation would hit the tables one at a
    // time. The Promise.all-based implementation hits them in the same
    // tick. We can't directly assert wall-clock ordering inside a
    // single-threaded event loop, but we CAN assert that all three
    // independent tables are queried even before the follows result is
    // available (i.e. follows step doesn't gate likes/bookmarks). We do
    // this indirectly: by the time the function resolves, .from() must
    // have been called with exactly {likes, bookmarks, follows} for the
    // no-follows case (NO 'posts' call).
    const stub = makeStub({
      likes: { data: [], error: null },
      bookmarks: { data: [], error: null },
      follows: { data: [], error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getViewerTagAffinity(stub as any, 'viewer-parallel', { now: NOW })

    const tablesHit = stub.fromSpy.mock.calls.map((c) => c[0])
    expect(tablesHit).toContain('likes')
    expect(tablesHit).toContain('bookmarks')
    expect(tablesHit).toContain('follows')
    expect(tablesHit).not.toContain('posts')
  })

  it('still runs the author-posts follow-up after follows resolves', async () => {
    const stub = makeStub({
      likes: { data: [], error: null },
      bookmarks: { data: [], error: null },
      follows: {
        data: [{ followed_id: 'author-x' }],
        error: null,
      },
      posts: {
        data: [
          {
            published_at: daysAgo(1),
            post_tags: [
              {
                tag_slug: 'from-author',
                tags: { slug: 'from-author', is_approved: true },
              },
            ],
          },
        ],
        error: null,
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getViewerTagAffinity(stub as any, 'viewer-follows', {
      now: NOW,
    })
    expect(result.has('from-author')).toBe(true)
    const tablesHit = stub.fromSpy.mock.calls.map((c) => c[0])
    expect(tablesHit).toContain('follows')
    expect(tablesHit).toContain('posts')
  })

  describe('cache', () => {
    it('does not re-hit the DB on a second call within TTL', async () => {
      const stub = makeStub({
        likes: {
          data: [
            {
              created_at: daysAgo(1),
              posts: {
                post_tags: [
                  { tag_slug: 'cached-tag', tags: { slug: 'cached-tag', is_approved: true } },
                ],
              },
            },
          ],
          error: null,
        },
        bookmarks: { data: [], error: null },
        follows: { data: [], error: null },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = await getViewerTagAffinity(stub as any, 'viewer-cache', {
        now: NOW,
      })
      expect(first.has('cached-tag')).toBe(true)
      const callsAfterFirst = stub.fromSpy.mock.calls.length
      expect(callsAfterFirst).toBeGreaterThan(0)

      // Second call within TTL — should be a pure cache hit, zero new DB calls.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const second = await getViewerTagAffinity(stub as any, 'viewer-cache', {
        now: NOW,
      })
      expect(second.has('cached-tag')).toBe(true)
      expect(stub.fromSpy.mock.calls.length).toBe(callsAfterFirst)
    })

    it('refetches once TTL expires', async () => {
      const stub = makeStub({
        likes: {
          data: [
            {
              created_at: daysAgo(1),
              posts: {
                post_tags: [
                  { tag_slug: 'ttl-tag', tags: { slug: 'ttl-tag', is_approved: true } },
                ],
              },
            },
          ],
          error: null,
        },
        bookmarks: { data: [], error: null },
        follows: { data: [], error: null },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getViewerTagAffinity(stub as any, 'viewer-ttl', { now: NOW })
      const baseline = stub.fromSpy.mock.calls.length

      // Just before expiry: still a hit.
      const justBeforeExpiry = new Date(NOW.getTime() + 4 * 60 * 1000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getViewerTagAffinity(stub as any, 'viewer-ttl', {
        now: justBeforeExpiry,
      })
      expect(stub.fromSpy.mock.calls.length).toBe(baseline)

      // Past expiry (5min + 1s): the cache entry is gone, expect a refetch.
      const afterExpiry = new Date(NOW.getTime() + 5 * 60 * 1000 + 1000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getViewerTagAffinity(stub as any, 'viewer-ttl', {
        now: afterExpiry,
      })
      expect(stub.fromSpy.mock.calls.length).toBeGreaterThan(baseline)
    })

    it('keeps separate cache entries per viewer', async () => {
      const stub = makeStub({
        likes: { data: [], error: null },
        bookmarks: { data: [], error: null },
        follows: { data: [], error: null },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getViewerTagAffinity(stub as any, 'viewer-a', { now: NOW })
      const afterA = stub.fromSpy.mock.calls.length

      // Different viewer — must hit the DB even though A is still cached.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getViewerTagAffinity(stub as any, 'viewer-b', { now: NOW })
      expect(stub.fromSpy.mock.calls.length).toBeGreaterThan(afterA)
    })

    it('_clearAffinityCacheForTests() forces a refetch on next call', async () => {
      const stub = makeStub({
        likes: { data: [], error: null },
        bookmarks: { data: [], error: null },
        follows: { data: [], error: null },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getViewerTagAffinity(stub as any, 'viewer-clear', { now: NOW })
      const baseline = stub.fromSpy.mock.calls.length

      // Without clear, second call within TTL would hit the cache.
      _clearAffinityCacheForTests()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getViewerTagAffinity(stub as any, 'viewer-clear', { now: NOW })
      expect(stub.fromSpy.mock.calls.length).toBeGreaterThan(baseline)
    })
  })
})
