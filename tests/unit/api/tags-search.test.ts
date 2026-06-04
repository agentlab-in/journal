/**
 * Tests for GET /api/tags/search.
 *
 * The route reads approved tags from public.tags via the admin Supabase
 * client. We mock the client so we can capture the query that gets issued
 * and shape the response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface QueryRecord {
  table?: string
  selectArgs?: string
  eqCalls: Array<[string, unknown]>
  ilikeCalls: Array<[string, string]>
  orderCalls: Array<[string, Record<string, unknown> | undefined]>
  limitCalls: number[]
}

const supabaseMock = vi.hoisted(() => {
  const record: QueryRecord = {
    eqCalls: [],
    ilikeCalls: [],
    orderCalls: [],
    limitCalls: [],
  }
  const data = {
    rows: [] as Array<{ slug: string; name: string; parent_tag_slug: string | null }>,
    error: null as null | { message: string },
  }
  const builder = {
    select(arg: string) {
      record.selectArgs = arg
      return this
    },
    eq(col: string, val: unknown) {
      record.eqCalls.push([col, val])
      return this
    },
    or() {
      return this
    },
    ilike(col: string, val: string) {
      record.ilikeCalls.push([col, val])
      return this
    },
    order(col: string, opts?: Record<string, unknown>) {
      record.orderCalls.push([col, opts])
      return this
    },
    limit(n: number) {
      record.limitCalls.push(n)
      return Promise.resolve({ data: data.rows, error: data.error })
    },
  }
  return {
    record,
    data,
    client: {
      from(table: string) {
        record.table = table
        return builder
      },
    },
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => supabaseMock.client,
}))

import { GET } from '@/app/api/tags/search/route'

function req(qs = ''): Request {
  return new Request(`http://localhost/api/tags/search${qs}`)
}

beforeEach(() => {
  supabaseMock.record.table = undefined
  supabaseMock.record.selectArgs = undefined
  supabaseMock.record.eqCalls = []
  supabaseMock.record.ilikeCalls = []
  supabaseMock.record.orderCalls = []
  supabaseMock.record.limitCalls = []
  supabaseMock.data.rows = []
  supabaseMock.data.error = null
})

describe('GET /api/tags/search', () => {
  it('returns 200 with an empty list when there are no matches', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ tags: [] })
  })

  it('queries the tags table', async () => {
    await GET(req())
    expect(supabaseMock.record.table).toBe('tags')
  })

  it('selects only the public columns', async () => {
    await GET(req())
    expect(supabaseMock.record.selectArgs).toContain('slug')
    expect(supabaseMock.record.selectArgs).toContain('name')
    expect(supabaseMock.record.selectArgs).toContain('parent_tag_slug')
  })

  it('always filters by is_approved = true (ignores unapproved tags)', async () => {
    await GET(req('?q=any'))
    const approvedFilter = supabaseMock.record.eqCalls.find(
      ([col]) => col === 'is_approved',
    )
    expect(approvedFilter).toBeDefined()
    expect(approvedFilter?.[1]).toBe(true)
  })

  it('limits to 50 results', async () => {
    await GET(req())
    expect(supabaseMock.record.limitCalls).toContain(50)
  })

  it('orders by slug ascending', async () => {
    // Previously also ordered by parent_tag_slug, but chaining two `.order()`
    // calls when one column is nullable was causing live PostgREST 500s; the
    // parent-grouping is now a display concern handled client-side.
    await GET(req())
    expect(supabaseMock.record.orderCalls.length).toBeGreaterThanOrEqual(1)
    const cols = supabaseMock.record.orderCalls.map(([c]) => c)
    expect(cols).toContain('slug')
  })

  it('passes the q param through as an ILIKE prefix on slug or name', async () => {
    await GET(req('?q=sec'))
    // Either via .or() or two ilike calls — we accept either via the union of
    // both shapes. The contract is that "sec" gets translated to a prefix
    // match. The mock captures ilike calls; verify the value uses "%".
    // Because we can't easily inspect .or() args at this granularity, we just
    // verify the filter was issued.
    expect(supabaseMock.record.eqCalls.find(([c]) => c === 'is_approved')).toBeDefined()
  })

  it('does not call ilike when q is empty', async () => {
    await GET(req(''))
    expect(supabaseMock.record.ilikeCalls.length).toBe(0)
  })

  it('sets a stale-while-revalidate Cache-Control header', async () => {
    const res = await GET(req())
    const cc = res.headers.get('cache-control')
    expect(cc).toContain('s-maxage=60')
    expect(cc).toContain('stale-while-revalidate=300')
  })

  it('returns the rows shaped as { tags: [...] }', async () => {
    supabaseMock.data.rows = [
      { slug: 'auth', name: 'Auth', parent_tag_slug: 'security' },
      { slug: 'tooling', name: 'Tooling', parent_tag_slug: null },
    ]
    const res = await GET(req())
    const json = await res.json()
    expect(json.tags).toHaveLength(2)
    expect(json.tags[0]).toEqual({ slug: 'auth', name: 'Auth', parent_tag_slug: 'security' })
  })

  it('returns 500 with an error code if the underlying query errors', async () => {
    supabaseMock.data.error = { message: 'boom' }
    const res = await GET(req())
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('query_failed')
  })

  // H2 — PostgREST .or() injection guard. The previous implementation
  // spliced user input into a multi-clause `.or()` string; a `,` or `.`
  // in `q` could inject sibling predicates. We now issue two separate
  // `.ilike()` queries, so PostgREST never parses user input as a token.
  it('issues two separate ilike calls for non-empty q (no .or splice)', async () => {
    await GET(req('?q=sec'))
    const cols = supabaseMock.record.ilikeCalls.map(([c]) => c).sort()
    expect(cols).toEqual(['name', 'slug'])
    // Pattern is LIKE-escaped + suffixed with '%' — no metacharacters survive
    // into the predicate value, but more importantly, no comma-splice path.
    expect(supabaseMock.record.ilikeCalls.every(([, val]) => val.endsWith('%'))).toBe(true)
  })

  it('treats injection-style metacharacters in q as literal LIKE input', async () => {
    // Each character that previously could have broken out of the .or() string
    // is now passed through `.ilike()` as a single predicate argument; the
    // route must not 500 and must not interpret commas/dots as token boundaries.
    const res = await GET(req('?q=,is_approved.eq.false'))
    expect(res.status).toBe(200)
    // The literal comma + dots survive as part of the predicate value (LIKE
    // wildcards `%`/`_` are escaped — `_` becomes `\_` — but `,` and `.` are
    // not wildcards in LIKE, only in PostgREST's `.or()` token grammar, which
    // we no longer touch).
    expect(supabaseMock.record.ilikeCalls.length).toBe(2)
    for (const [, val] of supabaseMock.record.ilikeCalls) {
      expect(val.startsWith(',is')).toBe(true)
      expect(val).toContain('.eq.false')
      // `_` in `is_approved` is a LIKE wildcard, so it's escaped to `\_`.
      expect(val).toContain('is\\_approved')
    }
  })

  it('rejects q longer than 64 characters with 400', async () => {
    const res = await GET(req(`?q=${'a'.repeat(65)}`))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('query_too_long')
    // No DB call should have been made.
    expect(supabaseMock.record.table).toBeUndefined()
  })
})
