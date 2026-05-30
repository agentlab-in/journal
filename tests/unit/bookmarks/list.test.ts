import { describe, it, expect, vi } from 'vitest'
import { listUserBookmarks } from '@/lib/bookmarks/list'

// ---------------------------------------------------------------------------
// Fake client builder helpers
// ---------------------------------------------------------------------------

type ListResult = {
  data: Array<Record<string, unknown>> | null
  error: unknown
}

function makeListChain(result: ListResult) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(() => Promise.resolve(result)),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  return chain
}

function makeClientFrom(chain: ReturnType<typeof makeListChain>) {
  return { from: vi.fn(() => chain) }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTHOR = {
  id: 'author-1',
  username: 'alice',
  display_name: 'Alice',
  avatar_url: 'https://example.com/a.jpg',
}

const POST = {
  id: 'post-1',
  type: 'post',
  slug: 'first',
  title: 'First',
  summary: 'Summary',
  cover_image_url: null,
  published_at: '2026-02-01T00:00:00Z',
  view_count: 10,
  comment_count: 2,
  deleted_at: null,
  users: AUTHOR,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listUserBookmarks', () => {
  it('returns [] when supabase returns no rows', async () => {
    const chain = makeListChain({ data: [], error: null })
    const admin = makeClientFrom(chain)
    const result = await listUserBookmarks(admin as never, 'user-1')
    expect(result).toEqual([])
    expect(admin.from).toHaveBeenCalledWith('bookmarks')
  })

  it('returns [] on a Supabase error', async () => {
    const chain = makeListChain({ data: null, error: { message: 'boom' } })
    const admin = makeClientFrom(chain)
    const result = await listUserBookmarks(admin as never, 'user-1')
    expect(result).toEqual([])
  })

  it('returns bookmarked posts mapped into BookmarkedPost shape', async () => {
    const rows = [
      { created_at: '2026-03-02T00:00:00Z', posts: POST },
      {
        created_at: '2026-03-01T00:00:00Z',
        posts: {
          ...POST,
          id: 'post-2',
          slug: 'second',
          title: 'Second',
          users: { ...AUTHOR, id: 'author-2', username: 'bob', display_name: 'Bob' },
        },
      },
    ]
    const chain = makeListChain({ data: rows, error: null })
    const admin = makeClientFrom(chain)
    const result = await listUserBookmarks(admin as never, 'user-1')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: 'post-1',
      type: 'post',
      slug: 'first',
      title: 'First',
      summary: 'Summary',
      cover_image_url: null,
      published_at: '2026-02-01T00:00:00Z',
      view_count: 10,
      comment_count: 2,
      bookmarked_at: '2026-03-02T00:00:00Z',
      author: {
        id: 'author-1',
        username: 'alice',
        display_name: 'Alice',
        avatar_url: 'https://example.com/a.jpg',
      },
    })
    expect(result[1].author.username).toBe('bob')

    // Verify the chain filters and ordering
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(100)
  })

  it('filters out rows whose joined post is null (hard-deleted)', async () => {
    const rows = [
      { created_at: '2026-03-02T00:00:00Z', posts: null },
      { created_at: '2026-03-01T00:00:00Z', posts: POST },
    ]
    const chain = makeListChain({ data: rows, error: null })
    const admin = makeClientFrom(chain)
    const result = await listUserBookmarks(admin as never, 'user-1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('post-1')
  })

  it('filters out soft-deleted posts', async () => {
    const rows = [
      {
        created_at: '2026-03-02T00:00:00Z',
        posts: { ...POST, deleted_at: '2026-03-03T00:00:00Z' },
      },
      { created_at: '2026-03-01T00:00:00Z', posts: POST },
    ]
    const chain = makeListChain({ data: rows, error: null })
    const admin = makeClientFrom(chain)
    const result = await listUserBookmarks(admin as never, 'user-1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('post-1')
  })

  it('coerces null comment_count to 0', async () => {
    const rows = [
      { created_at: '2026-03-02T00:00:00Z', posts: { ...POST, comment_count: null } },
    ]
    const chain = makeListChain({ data: rows, error: null })
    const admin = makeClientFrom(chain)
    const result = await listUserBookmarks(admin as never, 'user-1')
    expect(result[0].comment_count).toBe(0)
  })
})
