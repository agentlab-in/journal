/**
 * Unit tests for lib/admin/list-tags.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

import { listPendingTags } from '@/lib/admin/list-tags'

const NOW = '2025-01-15T10:00:00.000Z'

function makeTagsChain(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
  }
  // Make limit the terminal call
  chain.limit = vi.fn().mockImplementation(async () => ({ data: rows, error: null }))
  return chain
}

function makePostTagsCountChain(count: number) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation(async () => ({ count, data: null, error: null })),
  }
}

function makeFakeClient(opts: {
  tagRows?: unknown[]
} = {}) {
  const { tagRows = [] } = opts

  const tagsChain = makeTagsChain(tagRows)

  return {
    from: vi.fn((table: string) => {
      if (table === 'tags') return tagsChain
      if (table === 'post_tags') {
        return makePostTagsCountChain(0)
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      }
    }),
  }
}

describe('listPendingTags()', () => {
  beforeEach(() => {
    currentFakeClient = {}
  })

  it('returns empty rows when no pending tags', async () => {
    currentFakeClient = makeFakeClient({ tagRows: [] })

    const result = await listPendingTags()

    expect(result.rows).toEqual([])
    expect(result.nextCursor).toBeNull()
  })

  it('queries with is_approved=false AND rejected_at IS NULL', async () => {
    const tagsChain = makeTagsChain([])
    currentFakeClient = {
      from: vi.fn((table: string) => {
        if (table === 'tags') return tagsChain
        return { select: vi.fn().mockReturnThis(), eq: vi.fn(async () => ({ count: 0, error: null })) }
      }),
    }

    await listPendingTags()

    // is_approved=false
    expect(tagsChain.eq).toHaveBeenCalledWith('is_approved', false)
    // rejected_at IS NULL
    expect(tagsChain.is).toHaveBeenCalledWith('rejected_at', null)
    // orders newest first
    expect(tagsChain.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('returns nextCursor when more tags than limit', async () => {
    const makeTagRow = (i: number) => ({
      slug: `tag-${i}`,
      name: `Tag ${i}`,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    })

    const tagRows = Array.from({ length: 26 }, (_, i) => makeTagRow(i))
    const tagsChain = makeTagsChain(tagRows)

    currentFakeClient = {
      from: vi.fn((table: string) => {
        if (table === 'tags') return tagsChain
        if (table === 'post_tags') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn(async () => ({ count: 0, data: null, error: null })),
          }
        }
        return {}
      }),
    }

    const result = await listPendingTags({ limit: 25 })

    expect(result.rows).toHaveLength(25)
    expect(result.nextCursor).not.toBeNull()
  })

  it('returns null nextCursor when rows <= limit', async () => {
    const tagRows = [{ slug: 'my-tag', name: 'My Tag', created_at: NOW }]
    const tagsChain = makeTagsChain(tagRows)

    currentFakeClient = {
      from: vi.fn((table: string) => {
        if (table === 'tags') return tagsChain
        if (table === 'post_tags') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn(async () => ({ count: 5, data: null, error: null })),
          }
        }
        return {}
      }),
    }

    const result = await listPendingTags({ limit: 25 })

    expect(result.rows).toHaveLength(1)
    expect(result.nextCursor).toBeNull()
    expect(result.rows[0].slug).toBe('my-tag')
    expect(result.rows[0].name).toBe('My Tag')
  })
})
