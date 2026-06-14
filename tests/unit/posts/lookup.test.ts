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
 *
 * Phase 11: lookupPost now has an org branch — when the leading segment
 * doesn't match a user, the next `from` call is `orgs`, then `posts`,
 * then a second `users` (to hydrate the human author of an org-authored
 * post). The optional `orgResult` / `authorResult` parameters wire those
 * extra calls; left unset they default to null so the user-branch tests
 * still see the user-then-posts call pattern.
 */
function makeFakeClient(
  userResult: { data: MaybeRow; error: unknown },
  postResult: { data: MaybeRow; error: unknown },
  orgResult: { data: MaybeRow; error: unknown } = { data: null, error: null },
  authorResult: { data: MaybeRow; error: unknown } = { data: null, error: null },
) {
  const fromFn = vi.fn((table: string) => {
    if (table === 'users' || table === 'users_public') {
      // Heuristic: first users() call is the leading-segment lookup,
      // any subsequent users() call is the author hydration on the org
      // branch. Track call count on the fn so the second users() call
      // returns authorResult.
      const calls = (fromFn as unknown as { _usersCalls?: number })._usersCalls ?? 0
      ;(fromFn as unknown as { _usersCalls: number })._usersCalls = calls + 1
      return makeQueryChain(calls === 0 ? userResult : authorResult)
    }
    if (table === 'orgs') return makeQueryChain(orgResult)
    if (table === 'posts') return makeQueryChain(postResult)
    return makeQueryChain({ data: null, error: null })
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
  org_id: null,
  type: 'post',
  slug: 'my-great-post',
  title: 'My Great Post',
  summary: 'A summary',
  body_html: '<p>Hello</p>',
  cover_image_url: null,
  structured_sections: null,
  view_count: 42,
  comment_count: 7,
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

  // -------------------------------------------------------------------------
  // Error propagation — a genuine DB error must NOT collapse to a null
  // "not found". getCachedPost caches the result in unstable_cache (600s),
  // so a cached error-null would 404 a live post until the next
  // revalidation. lookupPost throws so the failure stays out of the cache.
  // -------------------------------------------------------------------------
  it('throws when the user lookup returns a DB error (instead of caching a null)', async () => {
    const db = makeFakeClient(
      { data: null, error: new Error('connection reset') },
      { data: POST_ROW, error: null },
    )
    await expect(lookupPost(db as never, VALID_PARAMS)).rejects.toThrow('connection reset')
  })

  it('throws when the post lookup returns a DB error', async () => {
    const db = makeFakeClient(
      { data: USER_ROW, error: null },
      { data: null, error: new Error('statement timeout') },
    )
    await expect(lookupPost(db as never, VALID_PARAMS)).rejects.toThrow('statement timeout')
  })

  it('still returns null on a clean miss (data null, error null) — not a throw', async () => {
    const db = makeFakeClient(
      { data: USER_ROW, error: null },
      { data: null, error: null },
    )
    await expect(lookupPost(db as never, VALID_PARAMS)).resolves.toBeNull()
  })
})
