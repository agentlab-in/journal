import { describe, it, expect, vi } from 'vitest'
import { resolveAnchor } from '@/lib/posts/wikilinks-resolve'

interface Row {
  id: string
  author_id: string
  username: string
  type: 'post' | 'playbook' | 'dive'
  slug: string
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

  it('prefers own post even when other posts are newer', async () => {
    const db = mockDb([
      {
        id: 'p-mine',
        author_id: me,
        username: 'me',
        type: 'post',
        slug: 'shared-slug',
        published_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'p-newer',
        author_id: 'user-other',
        username: 'pop',
        type: 'post',
        slug: 'shared-slug',
        published_at: '2026-05-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('Shared Slug', { db: db as never, currentUserId: me })
    expect(res?.targetPostId).toBe('p-mine')
  })

  it('uses newest published_at as tiebreak when no own post', async () => {
    const db = mockDb([
      {
        id: 'p-older',
        author_id: 'a',
        username: 'a',
        type: 'post',
        slug: 's',
        published_at: '2026-01-01T00:00:00Z',
        like_count: 50, // Discriminate: old ranking would pick this on high likes; new ranking picks p-newer on recency
      } as unknown as Row,
      {
        id: 'p-newer',
        author_id: 'b',
        username: 'b',
        type: 'post',
        slug: 's',
        published_at: '2026-05-01T00:00:00Z',
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
