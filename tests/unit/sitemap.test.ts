import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Fake Supabase client
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: unknown }

let postsResult: Result = { data: [], error: null }
let tagsResult: Result = { data: [], error: null }

function makeChain(result: Result) {
  const chain = {
    select: vi.fn(),
    is: vi.fn(),
    eq: vi.fn(),
    then: (resolve: (r: Result) => unknown) => resolve(result),
  }
  chain.select.mockReturnValue(chain)
  chain.is.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

const fakeClient = {
  from: vi.fn((table: string) => {
    if (table === 'posts') return makeChain(postsResult)
    if (table === 'tags') return makeChain(tagsResult)
    throw new Error(`unexpected table: ${table}`)
  }),
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => fakeClient,
}))

// Imported after vi.mock so the module sees the mocked client.
import sitemap from '@/app/sitemap'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POST_A = {
  slug: 'first-post',
  type: 'post',
  edited_at: null,
  published_at: '2026-01-01T00:00:00Z',
  users: { username: 'alice', updated_at: '2026-01-10T00:00:00Z' },
}

const POST_B_EDITED = {
  slug: 'second-post',
  type: 'playbook',
  edited_at: '2026-03-01T00:00:00Z',
  published_at: '2026-02-01T00:00:00Z',
  users: { username: 'alice', updated_at: '2026-01-10T00:00:00Z' },
}

const POST_C_OTHER_AUTHOR = {
  slug: 'another-post',
  type: 'dive',
  edited_at: null,
  published_at: '2026-04-01T00:00:00Z',
  users: { username: 'bob', updated_at: '2026-04-02T00:00:00Z' },
}

const TAG_APPROVED = {
  slug: 'agents',
  approved_at: '2026-01-15T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('app/sitemap', () => {
  beforeEach(() => {
    postsResult = { data: [], error: null }
    tagsResult = { data: [], error: null }
  })

  it('includes static routes (/, /latest, /tags, /search) with Date lastModified', async () => {
    const entries = await sitemap()
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('https://agentlab.in/')
    expect(urls).toContain('https://agentlab.in/latest')
    expect(urls).toContain('https://agentlab.in/tags')
    expect(urls).toContain('https://agentlab.in/search')
    for (const path of ['/', '/latest', '/tags', '/search']) {
      const entry = entries.find((e) => e.url === `https://agentlab.in${path}`)
      expect(entry?.lastModified).toBeInstanceOf(Date)
    }
  })

  it('produces post URLs at /<username>/<type>/<slug> with lastModified falling back to published_at when edited_at is null', async () => {
    postsResult = { data: [POST_A], error: null }
    const entries = await sitemap()
    const post = entries.find(
      (e) => e.url === 'https://agentlab.in/alice/post/first-post',
    )
    expect(post).toBeDefined()
    expect(post?.lastModified).toBe('2026-01-01T00:00:00Z')
  })

  it('uses edited_at over published_at for lastModified when present', async () => {
    postsResult = { data: [POST_B_EDITED], error: null }
    const entries = await sitemap()
    const post = entries.find(
      (e) => e.url === 'https://agentlab.in/alice/playbook/second-post',
    )
    expect(post).toBeDefined()
    expect(post?.lastModified).toBe('2026-03-01T00:00:00Z')
  })

  it('dedupes profile entries by username when an author has multiple posts', async () => {
    postsResult = { data: [POST_A, POST_B_EDITED, POST_C_OTHER_AUTHOR], error: null }
    const entries = await sitemap()
    const aliceEntries = entries.filter((e) => e.url === 'https://agentlab.in/alice')
    const bobEntries = entries.filter((e) => e.url === 'https://agentlab.in/bob')
    expect(aliceEntries).toHaveLength(1)
    expect(bobEntries).toHaveLength(1)
    expect(aliceEntries[0].lastModified).toBe('2026-01-10T00:00:00Z')
  })

  it('does NOT include profile entries for users with no posts (derived from posts query)', async () => {
    // Tags exist but no posts → no profile entries should appear, because
    // profiles are derived from the posts query result, not a users query.
    postsResult = { data: [], error: null }
    tagsResult = { data: [TAG_APPROVED], error: null }
    const entries = await sitemap()
    const staticUrls = new Set([
      'https://agentlab.in/',
      'https://agentlab.in/latest',
      'https://agentlab.in/tags',
      'https://agentlab.in/search',
    ])
    // Anything single-segment that isn't one of the known static routes or
    // a tag URL would be a stray profile entry.
    const stray = entries.filter(
      (e) =>
        /^https:\/\/agentlab\.in\/[^/]+$/.test(e.url) &&
        !staticUrls.has(e.url),
    )
    expect(stray).toHaveLength(0)
  })

  it('includes approved tag URLs with lastModified = approved_at', async () => {
    tagsResult = { data: [TAG_APPROVED], error: null }
    const entries = await sitemap()
    const tag = entries.find((e) => e.url === 'https://agentlab.in/tag/agents')
    expect(tag).toBeDefined()
    expect(tag?.lastModified).toBe('2026-01-15T00:00:00Z')
  })

  it('returns all URLs as absolute https:// origins', async () => {
    postsResult = { data: [POST_A, POST_C_OTHER_AUTHOR], error: null }
    tagsResult = { data: [TAG_APPROVED], error: null }
    const entries = await sitemap()
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.url.startsWith('https://')).toBe(true)
    }
  })
})
