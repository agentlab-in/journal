import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/auth — `sessionState.value` swaps per test.
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
  isAdmin: vi.fn(() => false),
  resolveIsAdmin: vi.fn(async () => false),
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/route-guard — bypass origin + RL checks. Each test re-imports
// route modules; we set `guardOverride` to inject a 429 or other failure when
// needed (none of these tests need that — we always succeed).
// ---------------------------------------------------------------------------
vi.mock('@/lib/route-guard', () => ({
  guardMutatingRequest: vi.fn(async () => ({ failed: false })),
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/slug-collisions — flexible per test
// ---------------------------------------------------------------------------
const slugCollisionState: {
  value: 'reserved' | 'username_taken' | 'org_slug_taken' | null
} = { value: null }

vi.mock('@/lib/slug-collisions', () => ({
  checkSlugCollision: vi.fn(async () => slugCollisionState.value),
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/logging/error-log — swallow noise.
// ---------------------------------------------------------------------------
vi.mock('@/lib/logging/error-log', () => ({
  logRouteError: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/admin — assignable per test.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

// ---------------------------------------------------------------------------
// Captured operations for assertion in happy-path tests.
// ---------------------------------------------------------------------------
interface CapturedOp {
  table: string
  op: 'insert' | 'update' | 'delete'
  payload?: unknown
  filters?: Record<string, unknown>
}
const capturedOps: CapturedOp[] = []

// ---------------------------------------------------------------------------
// Fake supabase client builder.
//
// Each table is its own micro state machine. We don't try to model the full
// Supabase client — only the chain shapes the routes actually call.
// ---------------------------------------------------------------------------
interface OrgRowShape {
  id: string
  slug: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  cover_image_url: string | null
  created_at: string
  updated_at: string
  created_by_user_id: string
  deleted_at: string | null
  banned_at: string | null
}

interface ClientOpts {
  org?: OrgRowShape | null
  // Map of `${org_id}::${user_id}` → role
  members?: Record<string, 'admin' | 'member'>
  // Username → user_id lookups for /users.
  users?: Record<string, string>
  // Org insert behavior — return id, or simulate error
  orgInsertResult?: {
    data?: { id: string; slug: string; display_name: string }
    error?: { code?: string; message?: string }
  }
  // Member-insert error injection (for unique-violation tests).
  memberInsertError?: { code?: string; message?: string }
  // Force update/delete to fail with zero-admin trigger.
  memberMutateError?: { code?: string; message?: string }
  // Org update payload returned echo (for PATCH happy path).
  orgUpdateResult?: {
    data?: Record<string, unknown>
    error?: { code?: string; message?: string }
  }
}

function makeClient(opts: ClientOpts = {}) {
  const members = { ...(opts.members ?? {}) }

  function orgsHandler() {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve(
              opts.org === undefined || opts.org === null
                ? { data: null, error: null }
                : { data: opts.org, error: null },
            ),
          ),
        })),
      })),
      insert: vi.fn((rows: unknown) => {
        capturedOps.push({ table: 'orgs', op: 'insert', payload: rows })
        const result = opts.orgInsertResult ?? {
          data: {
            id: 'new-org-id',
            slug: (rows as { slug: string }).slug,
            display_name: (rows as { display_name: string }).display_name,
          },
          error: null,
        }
        return {
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: result.data ?? null,
                error: result.error ?? null,
              }),
            ),
          })),
        }
      }),
      update: vi.fn((payload: unknown) => {
        capturedOps.push({ table: 'orgs', op: 'update', payload })
        return {
          eq: vi.fn(() => {
            // Two shapes: with `.select(...).single()` (PATCH) and plain
            // promise resolution (DELETE). Return a thenable that ALSO
            // exposes `.select().single()`.
            const updateResult = opts.orgUpdateResult ?? {
              data: { ...((payload as object) || {}) },
              error: null,
            }
            const finalResult = Promise.resolve({
              data: null,
              error: updateResult.error ?? null,
            })
            return Object.assign(finalResult, {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({
                    data: updateResult.data ?? null,
                    error: updateResult.error ?? null,
                  }),
                ),
              })),
            })
          }),
        }
      }),
    }
  }

  function orgMembersHandler() {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn((_col2: string, val2: unknown) => ({
            maybeSingle: vi.fn(() => {
              // The first `.eq` arg was filtered (org_id), then second is user_id.
              // We can't see the first val easily because vi.fn doesn't thread —
              // rely on the test setting members with a single org_id key.
              const orgId = opts.org?.id ?? ''
              const role = members[`${orgId}::${val2}`]
              if (role === undefined) {
                return Promise.resolve({ data: null, error: null })
              }
              return Promise.resolve({ data: { role, user_id: val2 }, error: null })
            }),
          })),
        })),
      })),
      insert: vi.fn((rows: unknown) => {
        capturedOps.push({ table: 'org_members', op: 'insert', payload: rows })
        if (opts.memberInsertError) {
          return Promise.resolve({ data: null, error: opts.memberInsertError })
        }
        // Update local state so subsequent reads see the new member.
        const r = rows as { org_id: string; user_id: string; role: 'admin' | 'member' }
        members[`${r.org_id}::${r.user_id}`] = r.role
        return Promise.resolve({ data: null, error: null })
      }),
      update: vi.fn((payload: unknown) => {
        capturedOps.push({ table: 'org_members', op: 'update', payload })
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({
                data: null,
                error: opts.memberMutateError ?? null,
              }),
            ),
          })),
        }
      }),
      delete: vi.fn(() => {
        capturedOps.push({ table: 'org_members', op: 'delete' })
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({
                data: null,
                error: opts.memberMutateError ?? null,
              }),
            ),
          })),
        }
      }),
    }
  }

  function usersHandler() {
    return {
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, val: unknown) => ({
          maybeSingle: vi.fn(() => {
            const id = (opts.users ?? {})[String(val)]
            return Promise.resolve(
              id ? { data: { id }, error: null } : { data: null, error: null },
            )
          }),
        })),
      })),
    }
  }

  function modActionsHandler() {
    return {
      insert: vi.fn((rows: unknown) => {
        capturedOps.push({ table: 'mod_actions', op: 'insert', payload: rows })
        return Promise.resolve({ data: null, error: null })
      }),
    }
  }

  return {
    from: vi.fn((table: string) => {
      switch (table) {
        case 'orgs':
          return orgsHandler()
        case 'org_members':
          return orgMembersHandler()
        case 'users':
          return usersHandler()
        case 'mod_actions':
          return modActionsHandler()
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const BASE_ORG: OrgRowShape = {
  id: 'org-1',
  slug: 'acme',
  display_name: 'Acme',
  bio: null,
  avatar_url: null,
  cover_image_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  created_by_user_id: 'user-creator',
  deleted_at: null,
  banned_at: null,
}

beforeEach(() => {
  sessionState.value = null
  slugCollisionState.value = null
  currentFakeClient = makeClient()
  capturedOps.length = 0
})

// ===========================================================================
// POST /api/orgs
// ===========================================================================

describe('POST /api/orgs', () => {
  it('returns 401 when unauthenticated', async () => {
    sessionState.value = null
    const { POST } = await import('@/app/api/orgs/route')
    const res = await POST(jsonRequest('http://test/api/orgs', 'POST', {
      slug: 'acme',
      display_name: 'Acme',
    }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 400 invalid_body for malformed slug', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    const { POST } = await import('@/app/api/orgs/route')
    const res = await POST(jsonRequest('http://test/api/orgs', 'POST', {
      slug: 'NotKebab!',
      display_name: 'Acme',
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 409 slug_taken with reason=reserved', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    slugCollisionState.value = 'reserved'
    const { POST } = await import('@/app/api/orgs/route')
    const res = await POST(jsonRequest('http://test/api/orgs', 'POST', {
      slug: 'admin',
      display_name: 'Acme',
    }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'slug_taken',
      reason: 'reserved',
    })
  })

  it('returns 409 slug_taken with reason=username_taken', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    slugCollisionState.value = 'username_taken'
    const { POST } = await import('@/app/api/orgs/route')
    const res = await POST(jsonRequest('http://test/api/orgs', 'POST', {
      slug: 'alice',
      display_name: 'Acme',
    }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'slug_taken',
      reason: 'username_taken',
    })
  })

  it('happy path inserts orgs row and admin org_members row', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    currentFakeClient = makeClient({
      orgInsertResult: {
        data: { id: 'org-new', slug: 'acme', display_name: 'Acme' },
        error: undefined,
      },
    })
    const { POST } = await import('@/app/api/orgs/route')
    const res = await POST(jsonRequest('http://test/api/orgs', 'POST', {
      slug: 'acme',
      display_name: 'Acme',
      bio: 'We build agents.',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({
      id: 'org-new',
      slug: 'acme',
      display_name: 'Acme',
    })

    const orgsInsert = capturedOps.find(
      (o) => o.table === 'orgs' && o.op === 'insert',
    )
    expect(orgsInsert).toBeTruthy()
    expect(orgsInsert!.payload).toMatchObject({
      slug: 'acme',
      display_name: 'Acme',
      bio: 'We build agents.',
      created_by_user_id: 'user-1',
    })

    const memberInsert = capturedOps.find(
      (o) => o.table === 'org_members' && o.op === 'insert',
    )
    expect(memberInsert).toBeTruthy()
    expect(memberInsert!.payload).toMatchObject({
      org_id: 'org-new',
      user_id: 'user-1',
      role: 'admin',
      added_by_user_id: 'user-1',
    })
  })
})

// ===========================================================================
// PATCH /api/orgs/[slug]
// ===========================================================================

describe('PATCH /api/orgs/[slug]', () => {
  it('returns 403 when caller is not admin of org', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    currentFakeClient = makeClient({
      org: BASE_ORG,
      members: { 'org-1::user-1': 'member' },
    })
    const { PATCH } = await import('@/app/api/orgs/[slug]/route')
    const res = await PATCH(
      jsonRequest('http://test/api/orgs/acme', 'PATCH', {
        display_name: 'New Acme',
      }),
      { params: Promise.resolve({ slug: 'acme' }) },
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  it('rejects slug change attempts with 400 slug_immutable', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    currentFakeClient = makeClient({
      org: BASE_ORG,
      members: { 'org-1::user-1': 'admin' },
    })
    const { PATCH } = await import('@/app/api/orgs/[slug]/route')
    const res = await PATCH(
      jsonRequest('http://test/api/orgs/acme', 'PATCH', {
        slug: 'acme-2',
        display_name: 'Acme Two',
      }),
      { params: Promise.resolve({ slug: 'acme' }) },
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'slug_immutable' })
  })
})

// ===========================================================================
// DELETE /api/orgs/[slug]
// ===========================================================================

describe('DELETE /api/orgs/[slug]', () => {
  it('admin happy path soft-deletes and writes mod_actions audit row', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    currentFakeClient = makeClient({
      org: BASE_ORG,
      members: { 'org-1::user-1': 'admin' },
    })
    const { DELETE } = await import('@/app/api/orgs/[slug]/route')
    const res = await DELETE(
      jsonRequest('http://test/api/orgs/acme', 'DELETE'),
      { params: Promise.resolve({ slug: 'acme' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('org-1')
    expect(body.slug).toBe('acme')
    expect(typeof body.deleted_at).toBe('string')

    const update = capturedOps.find(
      (o) => o.table === 'orgs' && o.op === 'update',
    )
    expect(update).toBeTruthy()
    expect((update!.payload as { deleted_at?: string }).deleted_at).toBeTruthy()

    const audit = capturedOps.find(
      (o) => o.table === 'mod_actions' && o.op === 'insert',
    )
    expect(audit).toBeTruthy()
    expect(audit!.payload).toMatchObject({
      mod_user_id: 'user-1',
      action: 'delete_org',
      target_type: 'org',
      target_id: 'org-1',
    })
  })
})

// ===========================================================================
// POST /api/orgs/[slug]/members
// ===========================================================================

describe('POST /api/orgs/[slug]/members', () => {
  it('returns 403 when caller is not admin', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    currentFakeClient = makeClient({
      org: BASE_ORG,
      members: { 'org-1::user-1': 'member' },
      users: { bob: 'user-bob' },
    })
    const { POST } = await import('@/app/api/orgs/[slug]/members/route')
    const res = await POST(
      jsonRequest('http://test/api/orgs/acme/members', 'POST', {
        username: 'bob',
        role: 'member',
      }),
      { params: Promise.resolve({ slug: 'acme' }) },
    )
    expect(res.status).toBe(403)
  })

  it('returns 409 already_member when target is already a member', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    currentFakeClient = makeClient({
      org: BASE_ORG,
      members: {
        'org-1::user-1': 'admin',
        'org-1::user-bob': 'member',
      },
      users: { bob: 'user-bob' },
    })
    const { POST } = await import('@/app/api/orgs/[slug]/members/route')
    const res = await POST(
      jsonRequest('http://test/api/orgs/acme/members', 'POST', {
        username: 'bob',
        role: 'member',
      }),
      { params: Promise.resolve({ slug: 'acme' }) },
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_member' })
  })
})

// ===========================================================================
// PATCH /api/orgs/[slug]/members/[user_id]
// ===========================================================================

describe('PATCH /api/orgs/[slug]/members/[user_id]', () => {
  it('maps zero-admin trigger error to 409 last_admin', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    currentFakeClient = makeClient({
      org: BASE_ORG,
      members: { 'org-1::user-1': 'admin' },
      memberMutateError: {
        code: '23514',
        message:
          'org_members_prevent_zero_admins: would leave org org-1 with no admins',
      },
    })
    const { PATCH } = await import(
      '@/app/api/orgs/[slug]/members/[user_id]/route'
    )
    const res = await PATCH(
      jsonRequest('http://test/api/orgs/acme/members/user-1', 'PATCH', {
        role: 'member',
      }),
      { params: Promise.resolve({ slug: 'acme', user_id: 'user-1' }) },
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'last_admin' })
  })
})

// ===========================================================================
// DELETE /api/orgs/[slug]/members/[user_id]
// ===========================================================================

describe('DELETE /api/orgs/[slug]/members/[user_id]', () => {
  it('allows self-removal even when caller is not admin', async () => {
    sessionState.value = { user: { id: 'user-bob' } }
    currentFakeClient = makeClient({
      org: BASE_ORG,
      members: {
        'org-1::user-1': 'admin',
        'org-1::user-bob': 'member',
      },
    })
    const { DELETE } = await import(
      '@/app/api/orgs/[slug]/members/[user_id]/route'
    )
    const res = await DELETE(
      jsonRequest('http://test/api/orgs/acme/members/user-bob', 'DELETE'),
      { params: Promise.resolve({ slug: 'acme', user_id: 'user-bob' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ org_id: 'org-1', user_id: 'user-bob' })
  })

  it('rejects non-admin removing someone else with 403', async () => {
    sessionState.value = { user: { id: 'user-bob' } }
    currentFakeClient = makeClient({
      org: BASE_ORG,
      members: {
        'org-1::user-1': 'admin',
        'org-1::user-bob': 'member',
        'org-1::user-carol': 'member',
      },
    })
    const { DELETE } = await import(
      '@/app/api/orgs/[slug]/members/[user_id]/route'
    )
    const res = await DELETE(
      jsonRequest('http://test/api/orgs/acme/members/user-carol', 'DELETE'),
      { params: Promise.resolve({ slug: 'acme', user_id: 'user-carol' }) },
    )
    expect(res.status).toBe(403)
  })

  it('maps zero-admin trigger error to 409 last_admin', async () => {
    sessionState.value = { user: { id: 'user-1' } }
    currentFakeClient = makeClient({
      org: BASE_ORG,
      members: { 'org-1::user-1': 'admin' },
      memberMutateError: {
        code: '23514',
        message:
          'org_members_prevent_zero_admins: would leave org org-1 with no admins',
      },
    })
    const { DELETE } = await import(
      '@/app/api/orgs/[slug]/members/[user_id]/route'
    )
    const res = await DELETE(
      jsonRequest('http://test/api/orgs/acme/members/user-1', 'DELETE'),
      { params: Promise.resolve({ slug: 'acme', user_id: 'user-1' }) },
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'last_admin' })
  })
})
