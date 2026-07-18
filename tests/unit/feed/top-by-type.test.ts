import { describe, it, expect, vi } from 'vitest'
import { getTopByType } from '@/lib/feed/top-by-type'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-06-01T12:00:00.000Z')

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString()
}

interface RowOpts {
  id?: string
  slug?: string
  title?: string
  type?: string
  org_id?: string | null
  published_at?: string
  authorUsername?: string
  authorDisplayName?: string | null
  orgSlug?: string | null
}

function makeRawRow(opts: RowOpts = {}) {
  const {
    id = 'post-1',
    slug = 'my-post',
    title = 'My Post',
    type = 'playbook',
    org_id = null,
    published_at = hoursAgo(2),
    authorUsername = 'alice',
    authorDisplayName = 'Alice',
    orgSlug = null,
  } = opts
  return {
    id,
    slug,
    title,
    type,
    org_id,
    published_at,
    author: { username: authorUsername, display_name: authorDisplayName },
    orgs: orgSlug !== null ? { slug: orgSlug } : null,
  }
}

/**
 * Build a fake Supabase db that returns the given rows (already in the
 * order the real query would return them: `published_at` descending).
 * Captures the .eq and .gte arguments for assertion.
 */
function buildDb(rows: ReturnType<typeof makeRawRow>[], opts: { error?: boolean } = {}) {
  const eqArgs: Array<[string, unknown]> = []
  const gteArgs: Array<[string, unknown]> = []
  const orderArgs: Array<[string, unknown]> = []

  const chain: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (r: (v: { data: unknown; error: unknown }) => void) => void
  } = {
    eq: vi.fn((col: string, val: unknown) => {
      eqArgs.push([col, val])
      return chain
    }),
    gte: vi.fn((col: string, val: unknown) => {
      gteArgs.push([col, val])
      return chain
    }),
    is: vi.fn(() => chain),
    order: vi.fn((col: string, opts: unknown) => {
      orderArgs.push([col, opts])
      return chain
    }),
    limit: vi.fn(() => chain),
  }

  chain.then = function (resolve) {
    resolve(
      opts.error
        ? { data: null, error: new Error('db error') }
        : { data: rows, error: null },
    )
  }

  const db = {
    from: vi.fn(() => ({
      select: vi.fn(() => chain),
    })),
    getEqArgs: () => eqArgs,
    getGteArgs: () => gteArgs,
    getOrderArgs: () => orderArgs,
  }

  return db
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getTopByType', () => {
  it('filters by the given type (asserts .eq arg)', async () => {
    const db = buildDb([makeRawRow({ type: 'playbook' })])
    await getTopByType(db as never, 'playbook', 7, 3)
    const eqArgs = db.getEqArgs()
    expect(eqArgs.some(([col, val]) => col === 'type' && val === 'playbook')).toBe(true)
  })

  it('filters by "dive" type when type=dive', async () => {
    const db = buildDb([makeRawRow({ type: 'dive' })])
    await getTopByType(db as never, 'dive', 7, 3)
    const eqArgs = db.getEqArgs()
    expect(eqArgs.some(([col, val]) => col === 'type' && val === 'dive')).toBe(true)
  })

  it('respects the limit', async () => {
    const rows = [
      makeRawRow({ id: '1', published_at: hoursAgo(1) }),
      makeRawRow({ id: '2', published_at: hoursAgo(2) }),
      makeRawRow({ id: '3', published_at: hoursAgo(3) }),
      makeRawRow({ id: '4', published_at: hoursAgo(4) }),
    ]
    const db = buildDb(rows)
    const result = await getTopByType(db as never, 'playbook', 7, 2)
    expect(result).toHaveLength(2)
  })

  it('preserves the query order (published_at descending): recency decides rank', async () => {
    // The DB query orders by published_at descending; a recently published
    // post must outrank an older one, because ranking is pure recency.
    const recent = makeRawRow({
      id: 'recent',
      published_at: hoursAgo(1),
    })
    const older = makeRawRow({
      id: 'older',
      published_at: hoursAgo(48),
    })

    // Rows arrive already ordered by published_at desc, as the real query
    // would return them: recent first.
    const db = buildDb([recent, older])
    const result = await getTopByType(db as never, 'playbook', 7, 3)

    expect(result[0].id).toBe('recent')
    expect(result[1].id).toBe('older')

    // Assert the query calls .order with the correct column and direction.
    const orderArgs = db.getOrderArgs()
    expect(orderArgs.some(([col, opts]) => col === 'published_at' && opts && typeof opts === 'object' && 'ascending' in opts && opts.ascending === false)).toBe(true)
  })

  it('returns [] on DB error', async () => {
    const db = buildDb([], { error: true })
    const result = await getTopByType(db as never, 'playbook', 7, 3)
    expect(result).toEqual([])
  })

  it('skips rows with null author', async () => {
    const rowWithAuthor = makeRawRow({ id: 'has-author', authorUsername: 'alice' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowWithoutAuthor: any = {
      ...makeRawRow({ id: 'no-author' }),
      author: null,
    }
    const db = buildDb([rowWithAuthor, rowWithoutAuthor])
    const result = await getTopByType(db as never, 'playbook', 7, 5)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('has-author')
  })

  it('uses org slug as leading_segment when org is present', async () => {
    const row = makeRawRow({
      id: 'org-post',
      org_id: 'org-uuid',
      orgSlug: 'acme-org',
      authorUsername: 'alice',
    })
    const db = buildDb([row])
    const result = await getTopByType(db as never, 'playbook', 7, 3)
    expect(result[0].leading_segment).toBe('acme-org')
  })

  it('uses author username as leading_segment when no org', async () => {
    const row = makeRawRow({
      id: 'personal-post',
      org_id: null,
      orgSlug: null,
      authorUsername: 'bob',
    })
    const db = buildDb([row])
    const result = await getTopByType(db as never, 'playbook', 7, 3)
    expect(result[0].leading_segment).toBe('bob')
  })

  it('filters published_at with the correct window cutoff', async () => {
    const fakeNow = new Date('2026-06-01T12:00:00.000Z')
    const expectedSince = new Date(fakeNow.getTime() - 7 * 86_400_000).toISOString()

    const db = buildDb([])

    vi.useFakeTimers()
    vi.setSystemTime(fakeNow)
    await getTopByType(db as never, 'playbook', 7, 3)
    vi.useRealTimers()

    const gteArgs = db.getGteArgs()
    expect(gteArgs.some(([col, val]) => col === 'published_at' && val === expectedSince)).toBe(true)
  })
})
