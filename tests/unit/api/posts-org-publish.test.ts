import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock next/cache so revalidateTag calls don't throw "static generation store missing"
// when running outside a Next.js render context.
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Phase 11 / T3 — POST + PATCH /api/posts gain `org_id`.
//
// Covers:
//   1. POST org_id member-of org → 201, posts row carries org_id, URL uses org slug.
//   2. POST org_id non-member  → 403 not_org_member.
//   3. POST org_id soft-deleted org → 404 org_not_found.
//   4. POST org_id banned org → 404 org_not_found.
//   5. POST without org_id → 201 personal post, URL uses author username.
//   6. PATCH org_id matching stored → 200 (no-op).
//   7. PATCH org_id differing from stored → 400 org_id_immutable.
//   8. PATCH without org_id → 200 (unchanged behavior for legacy clients).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }
const isAdminState = { value: false }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
  isAdmin: vi.fn(() => isAdminState.value),
  resolveIsAdmin: vi.fn(async () => isAdminState.value),
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/admin
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

// ---------------------------------------------------------------------------
// Captured operations for assertion
// ---------------------------------------------------------------------------
interface CapturedOp {
  table: string
  op: string
  payload: unknown
}
const capturedOps: CapturedOp[] = []

// ---------------------------------------------------------------------------
// Constants — known UUIDs (Zod requires UUID v4-shaped strings)
// ---------------------------------------------------------------------------
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = 'user-123'

// ---------------------------------------------------------------------------
// Fake-client builder for POST /api/posts
// ---------------------------------------------------------------------------
function makePostClient(opts: {
  username?: string
  orgRow?: {
    id: string
    slug: string
    deleted_at: string | null
    banned_at: string | null
  } | null
  isMember?: boolean
  newPostId?: string
} = {}) {
  const {
    username = 'alice',
    orgRow = null,
    isMember = false,
    newPostId = 'post-id-new',
  } = opts

  return {
    from: vi.fn((table: string) => {
      if (table === 'orgs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({ data: orgRow, error: null }),
              ),
            })),
          })),
        }
      }
      if (table === 'org_members') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: isMember ? { user_id: USER_ID } : null,
                    error: null,
                  }),
                ),
              })),
            })),
          })),
        }
      }
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({ data: { username }, error: null }),
              ),
            })),
          })),
        }
      }
      if (table === 'posts') {
        return {
          select: vi.fn((cols: string) => {
            // slug collision check: select('slug').eq.in
            if (cols === 'slug') {
              return {
                eq: vi.fn(() => ({
                  in: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              }
            }
            // wikilink resolve fallback
            return {
              eq: vi.fn(() => ({
                is: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            }
          }),
          insert: vi.fn((rows: unknown) => {
            capturedOps.push({ table: 'posts', op: 'insert', payload: rows })
            return {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({ data: { id: newPostId }, error: null }),
                ),
              })),
            }
          }),
        }
      }
      if (table === 'tags') {
        return {
          select: vi.fn(() => ({
            in: vi.fn((_col: string, vals: string[]) =>
              Promise.resolve({
                data: vals.map((slug) => ({ slug })), // pretend all tags exist
                error: null,
              }),
            ),
          })),
          insert: vi.fn(() =>
            Promise.resolve({ data: null, error: null }),
          ),
        }
      }
      // Fallback for post_tags, post_versions, post_references — capture inserts.
      return {
        insert: vi.fn((rows: unknown) => {
          capturedOps.push({ table, op: 'insert', payload: rows })
          return Promise.resolve({ data: null, error: null })
        }),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Fake-client builder for PATCH /api/posts/[id]
// ---------------------------------------------------------------------------
function makePatchClient(opts: {
  postRow: {
    id: string
    author_id: string
    org_id: string | null
    slug: string
    type: string
    body_md: string
    deleted_at: string | null
  }
  authorUsername?: string
  orgSlug?: string
}) {
  const { postRow, authorUsername = 'alice', orgSlug = 'acme' } = opts
  return {
    from: vi.fn((table: string) => {
      if (table === 'posts') {
        return {
          select: vi.fn((cols: string) => {
            // post load with deleted_at column
            if (cols.includes('deleted_at')) {
              return {
                eq: vi.fn(() => ({
                  single: vi.fn(() =>
                    Promise.resolve({ data: postRow, error: null }),
                  ),
                })),
              }
            }
            // wikilink resolve fallback
            return {
              eq: vi.fn(() => ({
                is: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            }
          }),
          update: vi.fn((payload: unknown) => ({
            eq: vi.fn(() => {
              capturedOps.push({ table: 'posts', op: 'update', payload })
              return Promise.resolve({ data: null, error: null })
            }),
          })),
        }
      }
      if (table === 'orgs') {
        // For PATCH URL response when post is under an org.
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: postRow.org_id
                    ? {
                        id: postRow.org_id,
                        slug: orgSlug,
                        deleted_at: null,
                        banned_at: null,
                      }
                    : null,
                  error: null,
                }),
              ),
            })),
          })),
        }
      }
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: { username: authorUsername },
                  error: null,
                }),
              ),
            })),
          })),
        }
      }
      if (table === 'tags') {
        return {
          select: vi.fn(() => ({
            in: vi.fn((_col: string, vals: string[]) =>
              Promise.resolve({
                data: vals.map((slug) => ({ slug })),
                error: null,
              }),
            ),
          })),
          insert: vi.fn(() =>
            Promise.resolve({ data: null, error: null }),
          ),
        }
      }
      if (table === 'post_versions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({ data: [{ version_no: 1 }], error: null }),
            ),
          })),
          insert: vi.fn((rows: unknown) => {
            capturedOps.push({
              table: 'post_versions',
              op: 'insert',
              payload: rows,
            })
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      // post_tags / post_references — delete + insert
      return {
        delete: vi.fn(() => ({
          eq: vi.fn(() => {
            capturedOps.push({ table, op: 'delete', payload: null })
            return Promise.resolve({ data: null, error: null })
          }),
        })),
        insert: vi.fn((rows: unknown) => {
          capturedOps.push({ table, op: 'insert', payload: rows })
          return Promise.resolve({ data: null, error: null })
        }),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Shared payloads
// ---------------------------------------------------------------------------
const VALID_BODY_MD = 'a'.repeat(60)
const VALID_CREATE_PAYLOAD = {
  type: 'post',
  title: 'Org Post',
  summary: 'Posted under an org.',
  body_md: VALID_BODY_MD,
  tags: ['rag'],
}
const VALID_PATCH_PAYLOAD = {
  title: 'Updated Title',
  summary: 'An updated summary here.',
  body_md: VALID_BODY_MD,
  tags: ['rag'],
}

function makePostRequest(body: unknown) {
  return new Request('http://test/api/posts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: JSON.stringify(body),
  })
}

function makePatchRequest(postId: string, body: unknown) {
  return new Request(`http://test/api/posts/${postId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: JSON.stringify(body),
  })
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ---------------------------------------------------------------------------
// POST: org membership / org status branches
// ---------------------------------------------------------------------------
describe('POST /api/posts — org_id branching', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    isAdminState.value = false
    capturedOps.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
  })

  it('returns 403 not_org_member when caller is not a member of the org', async () => {
    currentFakeClient = makePostClient({
      orgRow: { id: ORG_ID, slug: 'acme', deleted_at: null, banned_at: null },
      isMember: false,
    })
    const { POST } = await import('@/app/api/posts/route')
    const res = await POST(
      makePostRequest({ ...VALID_CREATE_PAYLOAD, org_id: ORG_ID }) as never,
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('not_org_member')
    // Ensure no posts row was inserted.
    expect(capturedOps.find((o) => o.table === 'posts')).toBeUndefined()
  })

  it('returns 404 org_not_found when the org is soft-deleted', async () => {
    currentFakeClient = makePostClient({
      orgRow: {
        id: ORG_ID,
        slug: 'acme',
        deleted_at: '2026-01-01T00:00:00Z',
        banned_at: null,
      },
      isMember: true,
    })
    const { POST } = await import('@/app/api/posts/route')
    const res = await POST(
      makePostRequest({ ...VALID_CREATE_PAYLOAD, org_id: ORG_ID }) as never,
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('org_not_found')
  })

  it('returns 404 org_not_found when the org is banned', async () => {
    currentFakeClient = makePostClient({
      orgRow: {
        id: ORG_ID,
        slug: 'acme',
        deleted_at: null,
        banned_at: '2026-01-01T00:00:00Z',
      },
      isMember: true,
    })
    const { POST } = await import('@/app/api/posts/route')
    const res = await POST(
      makePostRequest({ ...VALID_CREATE_PAYLOAD, org_id: OTHER_ORG_ID }) as never,
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('org_not_found')
  })

  it('returns 404 org_not_found when no org row exists for the id', async () => {
    currentFakeClient = makePostClient({ orgRow: null, isMember: false })
    const { POST } = await import('@/app/api/posts/route')
    const res = await POST(
      makePostRequest({ ...VALID_CREATE_PAYLOAD, org_id: ORG_ID }) as never,
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('org_not_found')
  })

  it('publishes under the org when caller is a member: 201, row has org_id, URL uses org slug', async () => {
    currentFakeClient = makePostClient({
      username: 'alice',
      orgRow: { id: ORG_ID, slug: 'acme', deleted_at: null, banned_at: null },
      isMember: true,
      newPostId: 'post-org-1',
    })
    const { POST } = await import('@/app/api/posts/route')
    const res = await POST(
      makePostRequest({ ...VALID_CREATE_PAYLOAD, org_id: ORG_ID }) as never,
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('post-org-1')
    // URL leading segment must be the org slug, not the username.
    expect(body.url).toBe(`/acme/post/${body.slug}`)

    // posts insert payload must carry org_id and author_id (audit).
    const postsInsert = capturedOps.find(
      (o) => o.table === 'posts' && o.op === 'insert',
    )
    expect(postsInsert).toBeDefined()
    const payload = postsInsert!.payload as {
      org_id: string | null
      author_id: string
    }
    expect(payload.org_id).toBe(ORG_ID)
    expect(payload.author_id).toBe(USER_ID)
  })

  it('publishes personally when org_id is omitted: 201, URL uses author username, org_id null', async () => {
    currentFakeClient = makePostClient({
      username: 'alice',
      newPostId: 'post-personal-1',
    })
    const { POST } = await import('@/app/api/posts/route')
    const res = await POST(makePostRequest(VALID_CREATE_PAYLOAD) as never)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.url).toBe(`/alice/post/${body.slug}`)

    const postsInsert = capturedOps.find(
      (o) => o.table === 'posts' && o.op === 'insert',
    )
    expect(postsInsert).toBeDefined()
    const payload = postsInsert!.payload as { org_id: string | null }
    expect(payload.org_id).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PATCH: org_id immutability
// ---------------------------------------------------------------------------
describe('PATCH /api/posts/[id] — org_id immutability', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    isAdminState.value = false
    capturedOps.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
  })

  it('returns 200 when body org_id matches the stored org_id (no-op)', async () => {
    currentFakeClient = makePatchClient({
      postRow: {
        id: 'post-abc',
        author_id: USER_ID,
        org_id: ORG_ID,
        slug: 'my-post',
        type: 'post',
        body_md: 'old body',
        deleted_at: null,
      },
      orgSlug: 'acme',
    })
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makePatchRequest('post-abc', {
        ...VALID_PATCH_PAYLOAD,
        org_id: ORG_ID,
      }) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // URL leading segment is the org slug (post is under an org).
    expect(body.url).toBe('/acme/post/my-post')
  })

  it('returns 400 org_id_immutable when body org_id differs from stored', async () => {
    currentFakeClient = makePatchClient({
      postRow: {
        id: 'post-abc',
        author_id: USER_ID,
        org_id: ORG_ID,
        slug: 'my-post',
        type: 'post',
        body_md: 'old body',
        deleted_at: null,
      },
    })
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makePatchRequest('post-abc', {
        ...VALID_PATCH_PAYLOAD,
        org_id: OTHER_ORG_ID,
      }) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('org_id_immutable')
    // No update should have been applied.
    expect(
      capturedOps.find((o) => o.table === 'posts' && o.op === 'update'),
    ).toBeUndefined()
  })

  it('returns 400 org_id_immutable when body sets org_id on a previously personal post', async () => {
    currentFakeClient = makePatchClient({
      postRow: {
        id: 'post-abc',
        author_id: USER_ID,
        org_id: null,
        slug: 'my-post',
        type: 'post',
        body_md: 'old body',
        deleted_at: null,
      },
    })
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makePatchRequest('post-abc', {
        ...VALID_PATCH_PAYLOAD,
        org_id: ORG_ID,
      }) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('org_id_immutable')
  })

  it('returns 200 when org_id is omitted entirely (legacy client) and post is personal', async () => {
    currentFakeClient = makePatchClient({
      postRow: {
        id: 'post-abc',
        author_id: USER_ID,
        org_id: null,
        slug: 'my-post',
        type: 'post',
        body_md: 'old body',
        deleted_at: null,
      },
      authorUsername: 'alice',
    })
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makePatchRequest('post-abc', VALID_PATCH_PAYLOAD) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // Personal post → URL uses author username.
    expect(body.url).toBe('/alice/post/my-post')

    // posts update payload must NOT mention org_id (immutable, never patched).
    const updateOp = capturedOps.find(
      (o) => o.table === 'posts' && o.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    expect('org_id' in payload).toBe(false)
  })
})
