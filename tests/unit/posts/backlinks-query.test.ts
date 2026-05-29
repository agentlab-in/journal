import { describe, it, expect, vi } from 'vitest'
import { fetchBacklinks } from '@/lib/posts/backlinks'

// ---------------------------------------------------------------------------
// Fake client builder helpers
// ---------------------------------------------------------------------------

type AnyRow = Record<string, unknown>

interface ChainOpts {
  data: AnyRow[] | null
  error: unknown
}

/**
 * Build a chainable Supabase-like query stub for the post_references or posts
 * table. The chain supports .select/.eq/.in/.is/.order all returning itself,
 * then resolving via implicit promise.
 */
function makeChain(result: ChainOpts) {
  const chain: Record<string, unknown> = {}
  const resolve = () => Promise.resolve(result)

  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.is = vi.fn(() => chain)
  chain.order = vi.fn(() => resolve())

  // Make chain itself thenable so `await db.from(...).select(...)...` works
  // when the final call returns a Promise.
  return chain
}

/**
 * Build a fake Supabase client where:
 * - First `from` call (post_references) resolves to `refsResult`
 * - Second `from` call (posts) resolves to `postsResult`
 *
 * The refs chain does NOT end with .order(), so we make `.eq()` return a
 * thenable directly.
 */
function makeFakeClient(refsResult: ChainOpts, postsResult: ChainOpts) {
  // refs chain: select → eq → resolves
  const refsChain: Record<string, unknown> = {}
  refsChain.select = vi.fn(() => refsChain)
  refsChain.eq = vi.fn(() => Promise.resolve(refsResult))

  // posts chain: select → in → is → order → resolves
  const postsChain = makeChain(postsResult)

  let callCount = 0
  const fromFn = vi.fn(() => {
    callCount++
    return callCount === 1 ? refsChain : postsChain
  })
  return { from: fromFn }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REF_ROW = { source_post_id: 'post-src-1' }

const POST_ROW = {
  id: 'post-src-1',
  title: 'Source Post',
  type: 'post',
  slug: 'source-post',
  published_at: '2026-03-01T00:00:00Z',
  deleted_at: null,
  users: { username: 'bob' },
}

const POST_ROW_2 = {
  id: 'post-src-2',
  title: 'Older Source Post',
  type: 'dive',
  slug: 'older-source-post',
  published_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  users: { username: 'alice' },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchBacklinks', () => {
  it('returns empty array when there are no references', async () => {
    const db = makeFakeClient({ data: [], error: null }, { data: [], error: null })
    const result = await fetchBacklinks(db as never, 'target-post-1')
    expect(result).toEqual([])
  })

  it('returns flat array sorted by published_at desc for non-deleted posts', async () => {
    // Two references
    const db = makeFakeClient(
      { data: [REF_ROW, { source_post_id: 'post-src-2' }], error: null },
      // posts already sorted by DB; we return newer first
      { data: [POST_ROW, POST_ROW_2], error: null },
    )
    const result = await fetchBacklinks(db as never, 'target-post-1')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: 'post-src-1',
      title: 'Source Post',
      type: 'post',
      slug: 'source-post',
      author_username: 'bob',
    })
    expect(result[1]).toEqual({
      id: 'post-src-2',
      title: 'Older Source Post',
      type: 'dive',
      slug: 'older-source-post',
      author_username: 'alice',
    })
  })

  it('filters out posts with deleted_at set (defensive belt-and-suspenders)', async () => {
    const deletedPost = { ...POST_ROW, deleted_at: '2026-04-01T00:00:00Z' }
    const db = makeFakeClient(
      { data: [REF_ROW], error: null },
      // Imagine DB didn't filter it (shouldn't happen, but defensive)
      { data: [deletedPost], error: null },
    )
    const result = await fetchBacklinks(db as never, 'target-post-1')
    expect(result).toEqual([])
  })

  it('filters out posts whose author user row is missing (defensive)', async () => {
    const noUserPost = { ...POST_ROW, users: null }
    const db = makeFakeClient(
      { data: [REF_ROW], error: null },
      { data: [noUserPost], error: null },
    )
    const result = await fetchBacklinks(db as never, 'target-post-1')
    expect(result).toEqual([])
  })

  it('returns empty array when refs query errors', async () => {
    const db = makeFakeClient(
      { data: null, error: new Error('db error') },
      { data: [], error: null },
    )
    const result = await fetchBacklinks(db as never, 'target-post-1')
    expect(result).toEqual([])
  })

  it('returns empty array when refs succeed but posts SELECT returns an error', async () => {
    const db = makeFakeClient(
      { data: [REF_ROW], error: null },
      { data: null, error: new Error('posts db error') },
    )
    const result = await fetchBacklinks(db as never, 'target-post-1')
    expect(result).toEqual([])
  })
})
