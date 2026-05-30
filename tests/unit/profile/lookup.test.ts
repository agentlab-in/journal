import { describe, it, expect, vi } from 'vitest'
import {
  lookupProfileByUsername,
  getPinnedPosts,
  getAuthoredPosts,
} from '@/lib/profile/lookup'

// ---------------------------------------------------------------------------
// Fake client builder helpers
// ---------------------------------------------------------------------------

type MaybeRow = Record<string, unknown> | null
type ListResult = { data: Array<Record<string, unknown>> | null; error: unknown }
type SingleResult = { data: MaybeRow; error: unknown }

function makeSingleChain(result: SingleResult) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.is.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.limit.mockReturnValue(chain)
  return chain
}

function makeListChain(result: ListResult) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(() => Promise.resolve(result)),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.is.mockReturnValue(chain)
  // After `.order(...)` the query may resolve directly when awaited (the
  // authored-posts query) OR be chained to `.limit(...)` (the pinned-posts
  // query). We return a thenable that also exposes `.limit` so both call
  // shapes work against the same fake.
  const thenable = {
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: ListResult) => unknown) => resolve(result),
  }
  chain.order.mockReturnValue(thenable)
  return chain
}

function makeClientFrom(chain: ReturnType<typeof makeSingleChain | typeof makeListChain>) {
  return { from: vi.fn(() => chain) }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ROW = {
  id: 'user-1',
  username: 'alice',
  display_name: 'Alice',
  bio: 'AI infra builder',
  avatar_url: 'https://example.com/a.jpg',
  github_login: 'Alice',
  created_at: '2026-01-01T00:00:00Z',
  follower_count: 12,
  following_count: 3,
}

const POST_ROW = {
  id: 'post-1',
  type: 'post',
  slug: 'first',
  title: 'First',
  summary: 'Summary',
  cover_image_url: null,
  published_at: '2026-02-01T00:00:00Z',
  view_count: 5,
  comment_count: 2,
  deleted_at: null,
  post_tags: [
    { tag_slug: 'agents', tags: { slug: 'agents', name: 'Agents', is_approved: true } },
  ],
}

// ---------------------------------------------------------------------------
// lookupProfileByUsername
// ---------------------------------------------------------------------------

describe('lookupProfileByUsername', () => {
  it('returns null when username has uppercase letters', async () => {
    const chain = makeSingleChain({ data: USER_ROW, error: null })
    const db = makeClientFrom(chain)
    const result = await lookupProfileByUsername(db as never, 'Alice')
    expect(result).toBeNull()
    expect(db.from).not.toHaveBeenCalled()
  })

  it('returns null when no row is found', async () => {
    const chain = makeSingleChain({ data: null, error: null })
    const db = makeClientFrom(chain)
    const result = await lookupProfileByUsername(db as never, 'alice')
    expect(result).toBeNull()
  })

  it('returns null on a Supabase error', async () => {
    const chain = makeSingleChain({ data: null, error: { message: 'boom' } })
    const db = makeClientFrom(chain)
    const result = await lookupProfileByUsername(db as never, 'alice')
    expect(result).toBeNull()
  })

  it('returns a typed profile when the row exists', async () => {
    const chain = makeSingleChain({ data: USER_ROW, error: null })
    const db = makeClientFrom(chain)
    const result = await lookupProfileByUsername(db as never, 'alice')
    expect(result).toEqual({
      id: 'user-1',
      username: 'alice',
      display_name: 'Alice',
      bio: 'AI infra builder',
      avatar_url: 'https://example.com/a.jpg',
      github_login: 'Alice',
      created_at: '2026-01-01T00:00:00Z',
      follower_count: 12,
      following_count: 3,
    })
    expect(db.from).toHaveBeenCalledWith('users')
    expect(chain.select).toHaveBeenCalledWith(
      expect.stringContaining('github_login'),
    )
    expect(chain.eq).toHaveBeenCalledWith('username', 'alice')
  })

  it('preserves a null github_login from the row', async () => {
    const chain = makeSingleChain({
      data: { ...USER_ROW, github_login: null },
      error: null,
    })
    const db = makeClientFrom(chain)
    const result = await lookupProfileByUsername(db as never, 'alice')
    expect(result?.github_login).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getPinnedPosts
// ---------------------------------------------------------------------------

describe('getPinnedPosts', () => {
  it('returns [] when supabase returns no rows', async () => {
    const chain = makeListChain({ data: [], error: null })
    const db = makeClientFrom(chain)
    const result = await getPinnedPosts(db as never, 'user-1')
    expect(result).toEqual([])
    expect(db.from).toHaveBeenCalledWith('pinned_posts')
  })

  it('returns [] on a Supabase error', async () => {
    const chain = makeListChain({ data: null, error: { message: 'fail' } })
    const db = makeClientFrom(chain)
    const result = await getPinnedPosts(db as never, 'user-1')
    expect(result).toEqual([])
  })

  it('returns pinned posts ordered by position with mapped tags', async () => {
    const rows = [
      { position: 1, posts: POST_ROW },
      { position: 2, posts: { ...POST_ROW, id: 'post-2', slug: 'second', title: 'Second' } },
    ]
    const chain = makeListChain({ data: rows, error: null })
    const db = makeClientFrom(chain)
    const result = await getPinnedPosts(db as never, 'user-1')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('post-1')
    expect(result[0].position).toBe(1)
    expect(result[0].tags).toEqual([
      { slug: 'agents', name: 'Agents', is_approved: true },
    ])
    expect(result[1].id).toBe('post-2')
    expect(result[1].position).toBe(2)
  })

  it('skips rows whose joined post is null', async () => {
    const rows = [
      { position: 1, posts: null },
      { position: 2, posts: POST_ROW },
    ]
    const chain = makeListChain({ data: rows, error: null })
    const db = makeClientFrom(chain)
    const result = await getPinnedPosts(db as never, 'user-1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('post-1')
  })

  it('skips soft-deleted posts', async () => {
    const rows = [
      { position: 1, posts: { ...POST_ROW, deleted_at: '2026-03-01T00:00:00Z' } },
      { position: 2, posts: POST_ROW },
    ]
    const chain = makeListChain({ data: rows, error: null })
    const db = makeClientFrom(chain)
    const result = await getPinnedPosts(db as never, 'user-1')
    expect(result).toHaveLength(1)
    expect(result[0].position).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// getAuthoredPosts
// ---------------------------------------------------------------------------

describe('getAuthoredPosts', () => {
  it('returns [] when supabase returns no rows', async () => {
    const chain = makeListChain({ data: [], error: null })
    const db = makeClientFrom(chain)
    const result = await getAuthoredPosts(db as never, 'user-1')
    expect(result).toEqual([])
    expect(db.from).toHaveBeenCalledWith('posts')
  })

  it('returns [] on a Supabase error', async () => {
    const chain = makeListChain({ data: null, error: { message: 'fail' } })
    const db = makeClientFrom(chain)
    const result = await getAuthoredPosts(db as never, 'user-1')
    expect(result).toEqual([])
  })

  it('returns mapped posts with flattened tags', async () => {
    const rows = [
      POST_ROW,
      { ...POST_ROW, id: 'post-2', slug: 'second', title: 'Second', post_tags: [] },
    ]
    const chain = makeListChain({ data: rows, error: null })
    const db = makeClientFrom(chain)
    const result = await getAuthoredPosts(db as never, 'user-1')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('post-1')
    expect(result[0].tags).toEqual([
      { slug: 'agents', name: 'Agents', is_approved: true },
    ])
    expect(result[1].tags).toEqual([])
  })

  it('passes author_id and deleted_at filters', async () => {
    const chain = makeListChain({ data: [POST_ROW], error: null })
    const db = makeClientFrom(chain)
    await getAuthoredPosts(db as never, 'user-1')
    expect(chain.eq).toHaveBeenCalledWith('author_id', 'user-1')
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null)
  })
})
