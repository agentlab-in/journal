/**
 * Phase 11 / T4 — URL routing, RSS, and sitemap for orgs.
 *
 * Covers the visibility-cascade decision: soft-deleted / banned orgs 404
 * their profile, their atom feed, AND any org-authored posts. The read
 * layer here re-applies the public-read RLS guard because the service-
 * role client used by the post / feed / sitemap lookups bypasses RLS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared chainable Supabase-mock helpers
// ---------------------------------------------------------------------------

type MaybeRow = Record<string, unknown> | null
type MaybeRows = Array<Record<string, unknown>> | null

interface MaybeSingleResult {
  data: MaybeRow
  error: unknown
}
interface ManyResult {
  data: MaybeRows
  error: unknown
}

/**
 * Build a chainable query that resolves either via `maybeSingle()` (for
 * the user/org single-row lookups) or via `then()` (for the many-row
 * post / orgs-list lookups).
 */
function makeChain(opts: {
  single?: MaybeSingleResult
  many?: ManyResult
}) {
  const single = opts.single
  const many = opts.many
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() =>
      Promise.resolve(single ?? { data: null, error: null }),
    ),
    then: (resolve: (r: ManyResult) => unknown) =>
      resolve(many ?? { data: [], error: null }),
  }
  return chain
}

// ---------------------------------------------------------------------------
// SECTION 1 — lookupPost org-branch coverage
// ---------------------------------------------------------------------------
describe('lookupPost (org branch)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function makeClient(opts: {
    userRow?: MaybeRow
    orgRow?: MaybeRow
    postRow?: MaybeRow
    authorRow?: MaybeRow
  }) {
    const userChains: Record<string, unknown>[] = [
      makeChain({ single: { data: opts.userRow ?? null, error: null } }),
      // Author hydration on the org branch.
      makeChain({ single: { data: opts.authorRow ?? null, error: null } }),
    ]
    let usersIdx = 0
    return {
      from: vi.fn((table: string) => {
        if (table === 'users' || table === 'users_public') {
          const c = userChains[usersIdx] ?? userChains[userChains.length - 1]
          usersIdx += 1
          return c
        }
        if (table === 'orgs') {
          return makeChain({ single: { data: opts.orgRow ?? null, error: null } })
        }
        if (table === 'posts') {
          return makeChain({ single: { data: opts.postRow ?? null, error: null } })
        }
        return makeChain({})
      }),
    }
  }

  const ORG_ROW = {
    id: 'org-1',
    slug: 'acme',
    display_name: 'Acme',
    avatar_url: null,
    deleted_at: null,
    banned_at: null,
  }
  const AUTHOR_ROW = {
    id: 'user-1',
    username: 'alice',
    display_name: 'Alice',
    avatar_url: null,
    bio: null,
  }
  const POST_ROW = {
    id: 'post-1',
    author_id: 'user-1',
    org_id: 'org-1',
    type: 'post',
    slug: 'org-post',
    title: 'Org Post',
    summary: 'Posted under acme.',
    body_html: '<p>hi</p>',
    cover_image_url: null,
    structured_sections: null,
    published_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    deleted_at: null,
    post_tags: [],
  }

  it('resolves an org-authored post via org slug as leading segment', async () => {
    const { lookupPost } = await import('@/lib/posts/lookup')
    const db = makeClient({
      userRow: null,
      orgRow: ORG_ROW,
      postRow: POST_ROW,
      authorRow: AUTHOR_ROW,
    })
    const result = await lookupPost(db as never, {
      username: 'acme',
      type: 'post',
      slug: 'org-post',
    })
    expect(result).not.toBeNull()
    expect(result?.org_id).toBe('org-1')
    expect(result?.org).toEqual({
      id: 'org-1',
      slug: 'acme',
      display_name: 'Acme',
      avatar_url: null,
    })
    expect(result?.author.username).toBe('alice')
  })

  it('404s an org-authored post when the org is soft-deleted', async () => {
    const { lookupPost } = await import('@/lib/posts/lookup')
    const db = makeClient({
      userRow: null,
      orgRow: { ...ORG_ROW, deleted_at: '2026-02-01T00:00:00Z' },
      postRow: POST_ROW,
      authorRow: AUTHOR_ROW,
    })
    const result = await lookupPost(db as never, {
      username: 'acme',
      type: 'post',
      slug: 'org-post',
    })
    expect(result).toBeNull()
  })

  it('404s an org-authored post when the org is banned', async () => {
    const { lookupPost } = await import('@/lib/posts/lookup')
    const db = makeClient({
      userRow: null,
      orgRow: { ...ORG_ROW, banned_at: '2026-02-01T00:00:00Z' },
      postRow: POST_ROW,
      authorRow: AUTHOR_ROW,
    })
    const result = await lookupPost(db as never, {
      username: 'acme',
      type: 'post',
      slug: 'org-post',
    })
    expect(result).toBeNull()
  })

  it('does not reach the org branch when a user matches the leading segment (org-authored posts are NOT exposed under the author username)', async () => {
    // User row exists but they have no PERSONAL post with this slug —
    // because the personal-post query filters org_id IS NULL, the
    // org-authored post must not leak through.
    const { lookupPost } = await import('@/lib/posts/lookup')
    const db = makeClient({
      userRow: { id: 'user-1', username: 'alice', display_name: 'Alice', avatar_url: null, bio: null },
      orgRow: ORG_ROW,
      postRow: null, // posts query for personal post returns null
      authorRow: AUTHOR_ROW,
    })
    const result = await lookupPost(db as never, {
      username: 'alice',
      type: 'post',
      slug: 'org-post',
    })
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// SECTION 2 — Profile page resolution (user-first / org fallback / 404)
// ---------------------------------------------------------------------------
describe('lookupOrgBySlug + lookupProfileByUsername precedence', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('lookupOrgBySlug returns null for soft-deleted orgs', async () => {
    const { lookupOrgBySlug } = await import('@/lib/profile/lookup')
    const db = {
      from: vi.fn(() =>
        makeChain({
          single: {
            data: {
              id: 'org-1',
              slug: 'acme',
              display_name: 'Acme',
              bio: null,
              avatar_url: null,
              cover_image_url: null,
              created_at: '2026-01-01T00:00:00Z',
              deleted_at: '2026-02-01T00:00:00Z',
              banned_at: null,
            },
            error: null,
          },
        }),
      ),
    }
    expect(await lookupOrgBySlug(db as never, 'acme')).toBeNull()
  })

  it('lookupOrgBySlug returns null for banned orgs', async () => {
    const { lookupOrgBySlug } = await import('@/lib/profile/lookup')
    const db = {
      from: vi.fn(() =>
        makeChain({
          single: {
            data: {
              id: 'org-1',
              slug: 'acme',
              display_name: 'Acme',
              bio: null,
              avatar_url: null,
              cover_image_url: null,
              created_at: '2026-01-01T00:00:00Z',
              deleted_at: null,
              banned_at: '2026-02-01T00:00:00Z',
            },
            error: null,
          },
        }),
      ),
    }
    expect(await lookupOrgBySlug(db as never, 'acme')).toBeNull()
  })

  it('lookupOrgBySlug returns the row for active orgs', async () => {
    const { lookupOrgBySlug } = await import('@/lib/profile/lookup')
    const db = {
      from: vi.fn(() =>
        makeChain({
          single: {
            data: {
              id: 'org-1',
              slug: 'acme',
              display_name: 'Acme',
              bio: 'We build agents.',
              avatar_url: 'https://example.com/a.png',
              cover_image_url: null,
              created_at: '2026-01-01T00:00:00Z',
              deleted_at: null,
              banned_at: null,
            },
            error: null,
          },
        }),
      ),
    }
    const org = await lookupOrgBySlug(db as never, 'acme')
    expect(org).not.toBeNull()
    expect(org?.slug).toBe('acme')
    expect(org?.display_name).toBe('Acme')
  })
})

// ---------------------------------------------------------------------------
// SECTION 3 — RSS feed (org branch)
// ---------------------------------------------------------------------------
describe('GET /[username]/feed.xml (org branch)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function makeFeedClient(opts: {
    userRow?: MaybeRow
    orgRow?: MaybeRow
    postRows?: Array<Record<string, unknown>>
  }) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'users' || table === 'users_public') {
          return makeChain({ single: { data: opts.userRow ?? null, error: null } })
        }
        if (table === 'orgs') {
          return makeChain({ single: { data: opts.orgRow ?? null, error: null } })
        }
        if (table === 'posts') {
          return makeChain({ many: { data: opts.postRows ?? [], error: null } })
        }
        return makeChain({})
      }),
    }
  }

  it('queries posts by org_id when the leading segment resolves to an org, limited to 50 entries', async () => {
    vi.doMock('@/lib/supabase/server', () => ({
      createServerSupabaseClient: () =>
        makeFeedClient({
          userRow: null,
          orgRow: {
            id: 'org-1',
            slug: 'acme',
            display_name: 'Acme',
            deleted_at: null,
            banned_at: null,
          },
          postRows: Array.from({ length: 50 }, (_, i) => ({
            title: `Post ${i}`,
            summary: 'sum',
            body_html: '<p>x</p>',
            type: 'post',
            slug: `p-${i}`,
            published_at: '2026-01-01T00:00:00Z',
            edited_at: null,
            users: { username: 'alice', display_name: 'Alice' },
          })),
        }),
    }))
    const { GET } = await import('@/app/[username]/feed.xml/route')
    const res = await GET(new Request('http://test/acme/feed.xml'), {
      params: Promise.resolve({ username: 'acme' }),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    // First link inside the feed self link must point at the org slug.
    expect(body).toContain('https://journal.agentlab.in/acme/feed.xml')
    expect(body).toContain('Acme (@acme)')
    // 50 entries.
    const entryCount = (body.match(/<entry>/g) ?? []).length
    expect(entryCount).toBe(50)
  })

  it('404s the feed when the org is soft-deleted', async () => {
    vi.doMock('@/lib/supabase/server', () => ({
      createServerSupabaseClient: () =>
        makeFeedClient({
          userRow: null,
          orgRow: {
            id: 'org-1',
            slug: 'acme',
            display_name: 'Acme',
            deleted_at: '2026-02-01T00:00:00Z',
            banned_at: null,
          },
        }),
    }))
    const { GET } = await import('@/app/[username]/feed.xml/route')
    const res = await GET(new Request('http://test/acme/feed.xml'), {
      params: Promise.resolve({ username: 'acme' }),
    })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// SECTION 4 — Sitemap (org profiles + org-authored post URLs)
// ---------------------------------------------------------------------------
describe('sitemap (org-aware)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('emits active-org profile URLs and routes org-authored posts under the org slug', async () => {
    const POSTS = [
      {
        slug: 'first-post',
        type: 'post',
        edited_at: null,
        published_at: '2026-01-01T00:00:00Z',
        users: { username: 'alice', updated_at: '2026-01-10T00:00:00Z' },
        orgs: null,
      },
      {
        slug: 'org-post',
        type: 'dive',
        edited_at: null,
        published_at: '2026-02-01T00:00:00Z',
        // Same author publishing under an org → URL must use org slug.
        users: { username: 'alice', updated_at: '2026-01-10T00:00:00Z' },
        orgs: { slug: 'acme' },
      },
    ]
    const ORGS = [
      { slug: 'acme', updated_at: '2026-01-15T00:00:00Z' },
      { slug: 'beta-org', updated_at: '2026-01-16T00:00:00Z' },
    ]

    vi.doMock('@/lib/supabase/server', () => ({
      createServerSupabaseClient: () => ({
        from: vi.fn((table: string) => {
          if (table === 'posts') {
            return makeChain({ many: { data: POSTS, error: null } })
          }
          if (table === 'orgs') {
            return makeChain({ many: { data: ORGS, error: null } })
          }
          if (table === 'tags') {
            return makeChain({ many: { data: [], error: null } })
          }
          return makeChain({})
        }),
      }),
    }))

    const sitemap = (await import('@/app/sitemap')).default
    const entries = await sitemap()
    const urls = entries.map((e) => e.url)

    // Org profile entries.
    expect(urls).toContain('https://journal.agentlab.in/acme')
    expect(urls).toContain('https://journal.agentlab.in/beta-org')
    // Org-authored post canonicalized at org slug, NOT at author username.
    expect(urls).toContain('https://journal.agentlab.in/acme/dive/org-post')
    expect(urls).not.toContain('https://journal.agentlab.in/alice/dive/org-post')
    // Personal post still emits at the author username.
    expect(urls).toContain('https://journal.agentlab.in/alice/post/first-post')
  })
})
