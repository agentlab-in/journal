import { describe, it, expect, vi } from 'vitest'
import { resolveAnchor } from '@/lib/posts/wikilinks-resolve'

interface Row {
  id: string
  author_id: string
  username: string
  type: 'post' | 'playbook' | 'dive'
  slug: string
  like_count: number
  published_at: string
  org_id?: string | null
  org_slug?: string | null
}

function rowToDbShape(r: Row) {
  return {
    id: r.id,
    author_id: r.author_id,
    org_id: r.org_id ?? null,
    slug: r.slug,
    type: r.type,
    published_at: r.published_at,
    like_count: r.like_count,
    users: { username: r.username },
    orgs: r.org_slug ? { slug: r.org_slug } : null,
  }
}

function mockDb(rows: Row[]) {
  const dbRows = rows.map(rowToDbShape)
  const isFn = vi.fn(() => Promise.resolve({ data: dbRows, error: null }))
  const eqFn = vi.fn(() => ({ is: isFn }))
  const selectFn = vi.fn(() => ({ eq: eqFn }))
  return { from: vi.fn(() => ({ select: selectFn })) }
}

describe('resolveAnchor', () => {
  const me = 'user-me'

  it('returns null when no posts match the slug', async () => {
    const db = mockDb([])
    const res = await resolveAnchor('Unknown Title', { db: db as never, currentUserId: me })
    expect(res).toBeNull()
  })

  it('prefers own post even when other posts have more likes', async () => {
    const db = mockDb([
      {
        id: 'p-mine',
        author_id: me,
        username: 'me',
        type: 'post',
        slug: 'shared-slug',
        like_count: 1,
        published_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'p-popular',
        author_id: 'user-other',
        username: 'pop',
        type: 'post',
        slug: 'shared-slug',
        like_count: 99,
        published_at: '2026-05-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('Shared Slug', { db: db as never, currentUserId: me })
    expect(res?.targetPostId).toBe('p-mine')
  })

  it('uses likes tiebreak when no own post', async () => {
    const db = mockDb([
      {
        id: 'p-old-pop',
        author_id: 'a',
        username: 'a',
        type: 'post',
        slug: 's',
        like_count: 50,
        published_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'p-newer-cold',
        author_id: 'b',
        username: 'b',
        type: 'post',
        slug: 's',
        like_count: 1,
        published_at: '2026-05-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('S', { db: db as never, currentUserId: me })
    expect(res?.targetPostId).toBe('p-old-pop')
  })

  it('falls back to recency when likes are tied', async () => {
    const db = mockDb([
      {
        id: 'p-newer',
        author_id: 'a',
        username: 'a',
        type: 'dive',
        slug: 's',
        like_count: 0,
        published_at: '2026-05-01T00:00:00Z',
      },
      {
        id: 'p-older',
        author_id: 'b',
        username: 'b',
        type: 'dive',
        slug: 's',
        like_count: 0,
        published_at: '2026-01-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('S', { db: db as never, currentUserId: me })
    expect(res?.targetPostId).toBe('p-newer')
  })

  it('returns the resolved row shape', async () => {
    const db = mockDb([
      {
        id: 'p1',
        author_id: 'a',
        username: 'alice',
        type: 'playbook',
        slug: 'agent-memory',
        like_count: 0,
        published_at: '2026-01-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('Agent Memory', {
      db: db as never,
      currentUserId: me,
    })
    expect(res).toEqual({
      targetPostId: 'p1',
      targetLeadingSegment: 'alice',
      targetType: 'playbook',
      targetSlug: 'agent-memory',
    })
  })

  it('uses org slug as leading segment when post is org-authored', async () => {
    const db = mockDb([
      {
        id: 'p1',
        author_id: 'a',
        username: 'alice',
        org_id: 'org-1',
        org_slug: 'acme',
        type: 'post',
        slug: 'rag-eval',
        like_count: 0,
        published_at: '2026-01-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('RAG Eval', {
      db: db as never,
      currentUserId: me,
    })
    expect(res?.targetLeadingSegment).toBe('acme')
    expect(res?.targetSlug).toBe('rag-eval')
  })
})
