import { describe, it, expect, vi } from 'vitest'
import { lookupPost } from '@/lib/posts/lookup'
import type { LookupParams } from '@/lib/posts/lookup'

// ---------------------------------------------------------------------------
// Fake client builder helpers
// ---------------------------------------------------------------------------

type MaybeRow = Record<string, unknown> | null

/** Build a chainable Supabase-like query stub that resolves to { data, error } */
function makeQueryChain(result: { data: MaybeRow; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.is.mockReturnValue(chain)
  return chain
}

/**
 * Build a fakeClient where the first `from` call (users lookup) resolves to
 * userResult, and the second (posts lookup) resolves to postResult.
 */
function makeFakeClient(
  userResult: { data: MaybeRow; error: unknown },
  postResult: { data: MaybeRow; error: unknown },
) {
  const userChain = makeQueryChain(userResult)
  const postChain = makeQueryChain(postResult)
  let callCount = 0
  const fromFn = vi.fn(() => {
    callCount++
    return callCount === 1 ? userChain : postChain
  })
  return { from: fromFn }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ROW = {
  id: 'user-1',
  username: 'alice',
  display_name: 'Alice',
  avatar_url: 'https://example.com/avatar.jpg',
  bio: 'AI infra builder',
}

const POST_ROW = {
  id: 'post-1',
  author_id: 'user-1',
  type: 'post',
  slug: 'my-great-post',
  title: 'My Great Post',
  summary: 'A summary',
  body_html: '<p>Hello</p>',
  cover_image_url: null,
  structured_sections: null,
  view_count: 42,
  published_at: '2026-01-01T00:00:00Z',
  edited_at: null,
  deleted_at: null,
  post_tags: [
    {
      tag_slug: 'agents',
      tags: { slug: 'agents', name: 'Agents', is_approved: true },
    },
    {
      tag_slug: 'infra',
      tags: { slug: 'infra', name: 'Infra', is_approved: false },
    },
  ],
}

const VALID_PARAMS: LookupParams = {
  username: 'alice',
  type: 'post',
  slug: 'my-great-post',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lookupPost', () => {
  it('returns null when type is not in POST_TYPES', async () => {
    const db = makeFakeClient(
      { data: USER_ROW, error: null },
      { data: POST_ROW, error: null },
    )
    const result = await lookupPost(db as never, { ...VALID_PARAMS, type: 'article' })
    expect(result).toBeNull()
  })

  it('returns null when username contains uppercase', async () => {
    const db = makeFakeClient(
      { data: USER_ROW, error: null },
      { data: POST_ROW, error: null },
    )
    const result = await lookupPost(db as never, { ...VALID_PARAMS, username: 'Alice' })
    expect(result).toBeNull()
  })

  it('returns null when user lookup returns no row', async () => {
    const db = makeFakeClient({ data: null, error: null }, { data: POST_ROW, error: null })
    const result = await lookupPost(db as never, VALID_PARAMS)
    expect(result).toBeNull()
  })

  it('returns null when posts lookup returns no row', async () => {
    const db = makeFakeClient({ data: USER_ROW, error: null }, { data: null, error: null })
    const result = await lookupPost(db as never, VALID_PARAMS)
    expect(result).toBeNull()
  })

  it('returns null when posts lookup returns a row with deleted_at set', async () => {
    const deletedPost = { ...POST_ROW, deleted_at: '2026-02-01T00:00:00Z' }
    const db = makeFakeClient(
      { data: USER_ROW, error: null },
      { data: deletedPost, error: null },
    )
    const result = await lookupPost(db as never, VALID_PARAMS)
    expect(result).toBeNull()
  })

  it('returns a populated LookedUpPost with flattened tags when the row exists', async () => {
    const db = makeFakeClient(
      { data: USER_ROW, error: null },
      { data: POST_ROW, error: null },
    )
    const result = await lookupPost(db as never, VALID_PARAMS)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('post-1')
    expect(result?.type).toBe('post')
    expect(result?.slug).toBe('my-great-post')
    expect(result?.title).toBe('My Great Post')
    expect(result?.view_count).toBe(42)
    expect(result?.author).toEqual({
      id: 'user-1',
      username: 'alice',
      display_name: 'Alice',
      avatar_url: 'https://example.com/avatar.jpg',
      bio: 'AI infra builder',
    })
    expect(result?.tags).toEqual([
      { slug: 'agents', name: 'Agents', is_approved: true },
      { slug: 'infra', name: 'Infra', is_approved: false },
    ])
  })

  it('returns post correctly when structured_sections is null', async () => {
    const db = makeFakeClient(
      { data: USER_ROW, error: null },
      { data: { ...POST_ROW, structured_sections: null }, error: null },
    )
    const result = await lookupPost(db as never, VALID_PARAMS)
    expect(result?.structured_sections).toBeNull()
  })

  it('returns post correctly when structured_sections is a populated jsonb object', async () => {
    const sections = { intro: 'Hello', conclusion: null }
    const db = makeFakeClient(
      { data: USER_ROW, error: null },
      { data: { ...POST_ROW, structured_sections: sections }, error: null },
    )
    const result = await lookupPost(db as never, VALID_PARAMS)
    expect(result?.structured_sections).toEqual({ intro: 'Hello', conclusion: null })
  })
})
