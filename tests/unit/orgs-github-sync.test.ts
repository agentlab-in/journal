/**
 * Phase 11.5 / T2 — syncUserGithubOrgs unit tests.
 *
 * Covers:
 *   - Happy path: new GitHub org → INSERT row + INSERT membership.
 *   - Existing active org → UPDATE in place, no double-insert.
 *   - Soft-deleted / banned orgs are skipped entirely.
 *   - Pruning: a user's membership in an org they no longer belong to on
 *     GitHub gets DELETEd; memberships to orgs without github_org_id are
 *     never pruned.
 *   - GitHub fetch failures (5xx / abort / malformed body) → no-op.
 *   - Idempotency: second run with same inputs reports empty added/removed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncUserGithubOrgs } from '@/lib/orgs/github-sync'

// ---------------------------------------------------------------------------
// Mock builders for the Supabase service-role client.
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: unknown }

interface OrgRow {
  id: string
  slug: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  github_org_id: number | null
  deleted_at: string | null
  banned_at: string | null
  created_by_user_id?: string
}

interface MemberRow {
  org_id: string
  user_id: string
  role: string
}

/**
 * In-memory Supabase service-role stub. Implements the narrow set of
 * chainable verbs syncUserGithubOrgs touches:
 *   orgs:        select.eq.maybeSingle / update.eq / insert.select.maybeSingle
 *   org_members: select.eq.eq.maybeSingle / select.eq / upsert / delete.eq.eq
 */
function makeDb(seed: { orgs?: OrgRow[]; members?: MemberRow[] } = {}) {
  const orgs: OrgRow[] = (seed.orgs ?? []).map((o) => ({ ...o }))
  const members: MemberRow[] = (seed.members ?? []).map((m) => ({ ...m }))
  const ops = {
    orgInserts: 0,
    orgUpdates: 0,
    memberUpserts: 0,
    memberDeletes: 0,
  }

  function orgsChain() {
    const state: {
      mode: 'select' | 'update' | 'insert' | null
      payload: Partial<OrgRow> | null
      filters: Array<[keyof OrgRow, unknown]>
    } = { mode: null, payload: null, filters: [] }

    function applyFilters(): OrgRow[] {
      return orgs.filter((o) =>
        state.filters.every(
          ([k, v]) => (o as unknown as Record<string, unknown>)[k as string] === v,
        ),
      )
    }

    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn((col: keyof OrgRow, val: unknown) => {
        state.filters.push([col, val])
        return chain
      }),
      update: vi.fn((payload: Partial<OrgRow>) => {
        state.mode = 'update'
        state.payload = payload
        return chain
      }),
      insert: vi.fn((payload: Partial<OrgRow>) => {
        state.mode = 'insert'
        state.payload = payload
        return chain
      }),
      maybeSingle: vi.fn(async (): Promise<Result> => {
        if (state.mode === 'insert') {
          // INSERT … .select().maybeSingle() — return the inserted row.
          const id = `org-new-${orgs.length + 1}`
          const row: OrgRow = {
            id,
            slug: state.payload?.slug ?? '',
            display_name: state.payload?.display_name ?? '',
            bio: state.payload?.bio ?? null,
            avatar_url: state.payload?.avatar_url ?? null,
            github_org_id: state.payload?.github_org_id ?? null,
            deleted_at: null,
            banned_at: null,
            created_by_user_id: state.payload?.created_by_user_id,
          }
          orgs.push(row)
          ops.orgInserts += 1
          return { data: { id }, error: null }
        }
        // select … .maybeSingle()
        const matches = applyFilters()
        return { data: matches[0] ?? null, error: null }
      }),
    }

    // Wrap update/insert so terminal awaits without `.select().maybeSingle()`
    // (the update path) resolve as a Promise of a write Result.
    const wrappedUpdate = chain.update as unknown as (
      payload: Partial<OrgRow>,
    ) => Record<string, unknown>
    chain.update = vi.fn((payload: Partial<OrgRow>) => {
      const ret = wrappedUpdate(payload) as Record<string, unknown>
      // Make the chain awaitable for the update path.
      ;(ret as { then?: unknown }).then = (resolve: (r: Result) => unknown) => {
        const matches = applyFilters()
        for (const m of matches) {
          Object.assign(m, payload)
        }
        if (matches.length > 0) ops.orgUpdates += 1
        return resolve({ data: null, error: null })
      }
      return ret
    })

    return chain
  }

  function membersChain() {
    const state: {
      mode: 'select' | 'upsert' | 'delete' | null
      payload: unknown
      filters: Array<[keyof MemberRow, unknown]>
    } = { mode: null, payload: null, filters: [] }

    function applyFilters(): MemberRow[] {
      return members.filter((m) =>
        state.filters.every(
          ([k, v]) => (m as unknown as Record<string, unknown>)[k as string] === v,
        ),
      )
    }

    const chain: Record<string, unknown> = {
      select: vi.fn(() => {
        state.mode = 'select'
        return chain
      }),
      eq: vi.fn((col: keyof MemberRow, val: unknown) => {
        state.filters.push([col, val])
        return chain
      }),
      maybeSingle: vi.fn(async (): Promise<Result> => {
        const matches = applyFilters()
        return { data: matches[0] ?? null, error: null }
      }),
      upsert: vi.fn((payload: Partial<MemberRow>) => {
        state.mode = 'upsert'
        state.payload = payload
        // Awaitable — resolves with write Result.
        return {
          then: (resolve: (r: Result) => unknown) => {
            const exists = members.some(
              (m) => m.org_id === payload.org_id && m.user_id === payload.user_id,
            )
            if (!exists) {
              members.push({
                org_id: payload.org_id ?? '',
                user_id: payload.user_id ?? '',
                role: payload.role ?? 'member',
              })
              ops.memberUpserts += 1
            }
            return resolve({ data: null, error: null })
          },
        }
      }),
      delete: vi.fn(() => {
        state.mode = 'delete'
        return chain
      }),
      // For the prune path: `.select(..., orgs(...))` returns the chain and then
      // a terminal `.eq('user_id', ...)` makes the result awaitable as an array.
      then: undefined as unknown as undefined,
    }

    // Make `select(...)` produce a chain whose final `.eq()` is awaitable as
    // an array for the prune list query.
    const wrappedSelect = chain.select as unknown as () => Record<string, unknown>
    chain.select = vi.fn((cols?: string) => {
      wrappedSelect()
      if (typeof cols === 'string' && cols.includes('orgs(')) {
        // Many-row mode with embedded orgs.
        const arrChain: Record<string, unknown> = {
          eq: vi.fn((col: keyof MemberRow, val: unknown) => {
            state.filters.push([col, val])
            return arrChain
          }),
          then: (resolve: (r: Result) => unknown) => {
            const matches = applyFilters()
            const enriched = matches.map((m) => ({
              org_id: m.org_id,
              orgs:
                orgs.find((o) => o.id === m.org_id)
                  ? {
                      github_org_id:
                        orgs.find((o) => o.id === m.org_id)!.github_org_id ?? null,
                      slug: orgs.find((o) => o.id === m.org_id)!.slug,
                    }
                  : null,
            }))
            return resolve({ data: enriched, error: null })
          },
        }
        return arrChain
      }
      return chain
    })

    // Wrap delete().eq().eq() to be awaitable.
    const wrappedDelete = chain.delete as unknown as () => Record<string, unknown>
    chain.delete = vi.fn(() => {
      wrappedDelete()
      // Build a small chain that collects two eq()s then is awaitable.
      const delChain: Record<string, unknown> = {
        eq: vi.fn((col: keyof MemberRow, val: unknown) => {
          state.filters.push([col, val])
          return delChain
        }),
        then: (resolve: (r: Result) => unknown) => {
          const matches = applyFilters()
          for (const m of matches) {
            const idx = members.indexOf(m)
            if (idx >= 0) {
              members.splice(idx, 1)
              ops.memberDeletes += 1
            }
          }
          return resolve({ data: null, error: null })
        },
      }
      return delChain
    })

    return chain
  }

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'orgs') return orgsChain()
      if (table === 'org_members') return membersChain()
      throw new Error(`unexpected table ${table}`)
    }),
  }

  return { supabase, orgs, members, ops }
}

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchOk(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch
}

function mockFetchStatus(status: number, body: unknown = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

function mockFetchAbort() {
  return vi.fn(async () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    throw err
  }) as unknown as typeof fetch
}

const ORG_PAYLOAD = {
  id: 42,
  login: 'Acme-Co',
  avatar_url: 'https://avatars.githubusercontent.com/42',
  description: 'We build agents.',
  name: 'Acme Corporation',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncUserGithubOrgs', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts a new org row + membership when GitHub returns an org not in DB', async () => {
    globalThis.fetch = mockFetchOk([ORG_PAYLOAD])
    const { supabase, orgs, members, ops } = makeDb()

    const result = await syncUserGithubOrgs({
      supabase: supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })

    expect(result.added).toEqual(['acme-co'])
    expect(result.removed).toEqual([])
    expect(result.total).toBe(1)
    expect(ops.orgInserts).toBe(1)
    expect(ops.memberUpserts).toBe(1)
    const inserted = orgs[0]!
    expect(inserted.slug).toBe('acme-co')
    expect(inserted.display_name).toBe('Acme Corporation')
    expect(inserted.bio).toBe('We build agents.')
    expect(inserted.avatar_url).toBe('https://avatars.githubusercontent.com/42')
    expect(inserted.github_org_id).toBe(42)
    expect(inserted.created_by_user_id).toBe('user-1')
    expect(members).toHaveLength(1)
    expect(members[0]!.role).toBe('member')
  })

  it('reuses an existing active org row keyed by github_org_id (no insert)', async () => {
    globalThis.fetch = mockFetchOk([ORG_PAYLOAD])
    const { supabase, orgs, members, ops } = makeDb({
      orgs: [
        {
          id: 'org-existing',
          slug: 'acme-co',
          display_name: 'Old Name',
          bio: null,
          avatar_url: null,
          github_org_id: 42,
          deleted_at: null,
          banned_at: null,
        },
      ],
    })

    const result = await syncUserGithubOrgs({
      supabase: supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })

    expect(ops.orgInserts).toBe(0)
    expect(ops.orgUpdates).toBeGreaterThanOrEqual(1)
    // Metadata refreshed.
    expect(orgs[0]!.display_name).toBe('Acme Corporation')
    expect(orgs[0]!.bio).toBe('We build agents.')
    // First-time membership for this user.
    expect(result.added).toEqual(['acme-co'])
    expect(members).toHaveLength(1)
  })

  it('skips a soft-deleted org row (no insert, no membership)', async () => {
    globalThis.fetch = mockFetchOk([ORG_PAYLOAD])
    const { supabase, members, ops } = makeDb({
      orgs: [
        {
          id: 'org-existing',
          slug: 'acme-co',
          display_name: 'Acme',
          bio: null,
          avatar_url: null,
          github_org_id: 42,
          deleted_at: '2026-01-01T00:00:00Z',
          banned_at: null,
        },
      ],
    })

    const result = await syncUserGithubOrgs({
      supabase: supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })

    expect(result.added).toEqual([])
    expect(result.total).toBe(0)
    expect(ops.orgInserts).toBe(0)
    expect(ops.memberUpserts).toBe(0)
    expect(members).toHaveLength(0)
  })

  it('skips a banned org row (no insert, no membership)', async () => {
    globalThis.fetch = mockFetchOk([ORG_PAYLOAD])
    const { supabase, members, ops } = makeDb({
      orgs: [
        {
          id: 'org-existing',
          slug: 'acme-co',
          display_name: 'Acme',
          bio: null,
          avatar_url: null,
          github_org_id: 42,
          deleted_at: null,
          banned_at: '2026-01-01T00:00:00Z',
        },
      ],
    })

    const result = await syncUserGithubOrgs({
      supabase: supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })

    expect(result.added).toEqual([])
    expect(result.total).toBe(0)
    expect(ops.orgInserts).toBe(0)
    expect(ops.memberUpserts).toBe(0)
    expect(members).toHaveLength(0)
  })

  it('prunes a stale GitHub-backed membership that is no longer present in /user/orgs', async () => {
    // GitHub returns Acme only — Beta is stale.
    globalThis.fetch = mockFetchOk([ORG_PAYLOAD])
    const { supabase, members, ops } = makeDb({
      orgs: [
        {
          id: 'org-acme',
          slug: 'acme-co',
          display_name: 'Acme',
          bio: null,
          avatar_url: null,
          github_org_id: 42,
          deleted_at: null,
          banned_at: null,
        },
        {
          id: 'org-beta',
          slug: 'beta',
          display_name: 'Beta',
          bio: null,
          avatar_url: null,
          github_org_id: 99,
          deleted_at: null,
          banned_at: null,
        },
        {
          id: 'org-legacy',
          slug: 'legacy',
          display_name: 'Legacy',
          bio: null,
          avatar_url: null,
          github_org_id: null, // manual seed — must NOT be pruned
          deleted_at: null,
          banned_at: null,
        },
      ],
      members: [
        { org_id: 'org-acme', user_id: 'user-1', role: 'member' },
        { org_id: 'org-beta', user_id: 'user-1', role: 'member' },
        { org_id: 'org-legacy', user_id: 'user-1', role: 'member' },
      ],
    })

    const result = await syncUserGithubOrgs({
      supabase: supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })

    expect(result.removed).toEqual(['beta'])
    expect(ops.memberDeletes).toBe(1)
    // Acme + legacy memberships survive.
    expect(members.map((m) => m.org_id).sort()).toEqual(['org-acme', 'org-legacy'])
  })

  it('returns a clean no-op when GitHub returns 500', async () => {
    globalThis.fetch = mockFetchStatus(500, { message: 'kaboom' })
    const { supabase, members, ops } = makeDb()

    const result = await syncUserGithubOrgs({
      supabase: supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })

    expect(result).toEqual({ added: [], removed: [], total: 0 })
    expect(ops.orgInserts).toBe(0)
    expect(ops.memberUpserts).toBe(0)
    expect(members).toHaveLength(0)
    // No Supabase calls at all on fetch failure.
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('returns a clean no-op when GitHub returns 401', async () => {
    globalThis.fetch = mockFetchStatus(401, { message: 'unauthorized' })
    const { supabase } = makeDb()

    const result = await syncUserGithubOrgs({
      supabase: supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })

    expect(result).toEqual({ added: [], removed: [], total: 0 })
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('returns a clean no-op on an AbortError (timeout simulation)', async () => {
    globalThis.fetch = mockFetchAbort()
    const { supabase } = makeDb()

    const result = await syncUserGithubOrgs({
      supabase: supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })

    expect(result).toEqual({ added: [], removed: [], total: 0 })
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('returns a clean no-op when GitHub returns a non-array body', async () => {
    globalThis.fetch = mockFetchOk({ unexpected: true })
    const { supabase } = makeDb()

    const result = await syncUserGithubOrgs({
      supabase: supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })

    expect(result).toEqual({ added: [], removed: [], total: 0 })
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('is idempotent — second run with same input adds nothing', async () => {
    globalThis.fetch = mockFetchOk([ORG_PAYLOAD])
    const db = makeDb()

    const first = await syncUserGithubOrgs({
      supabase: db.supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })
    expect(first.added).toEqual(['acme-co'])

    globalThis.fetch = mockFetchOk([ORG_PAYLOAD])
    const second = await syncUserGithubOrgs({
      supabase: db.supabase as never,
      userId: 'user-1',
      githubAccessToken: 'token',
    })
    expect(second.added).toEqual([])
    expect(second.removed).toEqual([])
    expect(second.total).toBe(1)
    expect(db.ops.orgInserts).toBe(1) // still just one
    expect(db.members).toHaveLength(1)
  })
})
