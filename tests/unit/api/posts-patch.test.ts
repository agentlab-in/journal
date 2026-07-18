import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: next/cache — revalidateTag
// ---------------------------------------------------------------------------
const revalidateTagMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }
const isAdminState = { value: false }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
  isAdmin: vi.fn((login: string) => {
    void login
    return isAdminState.value
  }),
  resolveIsAdmin: vi.fn(async (_userId: string) => isAdminState.value),
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
interface CapturedOp { table: string; op: string; payload: unknown }
const capturedOps: CapturedOp[] = []

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

const EXISTING_POST: {
  id: string
  author_id: string
  slug: string
  type: string
  body_md: string
  deleted_at: string | null
} = {
  id: 'post-abc',
  author_id: 'user-123',
  slug: 'my-post',
  type: 'post',
  body_md: 'old body content that was prior',
  deleted_at: null,
}

const AUTHOR_ROW = { username: 'alice' }
const NA_USER_ROW = { github_login: 'alice-gh' }

/**
 * Build a no-op delete stub for a table.
 */
function deleteOnlyHandler(table: string, expectField?: string) {
  return {
    delete: vi.fn(() => ({
      eq: vi.fn((field: string, val: unknown) => {
        capturedOps.push({ table, op: 'delete', payload: { [field]: val } })
        return Promise.resolve({ data: null, error: null })
      }),
    })),
    insert: vi.fn((rows: unknown) => {
      capturedOps.push({ table, op: 'insert', payload: rows })
      return Promise.resolve({ data: null, error: null })
    }),
    ...(expectField ? {} : {}),
  }
}

/**
 * Build a tags handler that returns existing tags.
 */
function tagsHandler(existingTagSlugs: string[] = []) {
  return {
    select: vi.fn(() => ({
      in: vi.fn((_col: string, vals: string[]) =>
        Promise.resolve({
          data: vals
            .filter((v) => existingTagSlugs.includes(v))
            .map((slug) => ({ slug })),
          error: null,
        }),
      ),
    })),
    insert: vi.fn((rows: unknown) => {
      capturedOps.push({ table: 'tags', op: 'insert', payload: rows })
      return Promise.resolve({ data: null, error: null })
    }),
  }
}

/**
 * Build the posts handler — handles select for post load + wikilink resolve.
 */
function postsHandler(opts: {
  postRow?: typeof EXISTING_POST | null
  wikilinkedPosts?: unknown[]
} = {}) {
  const { postRow = EXISTING_POST, wikilinkedPosts = [] } = opts
  return {
    select: vi.fn((cols: string) => {
      // post load: select('id, author_id, slug, type, body_md, deleted_at').eq('id', ...).single()
      if (cols.includes('deleted_at')) {
        return {
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve(
                postRow
                  ? { data: postRow, error: null }
                  : { data: null, error: { message: 'not found' } },
              ),
            ),
          })),
        }
      }
      // wikilink resolve: select(...published_at, users!inner(username)).eq(slug).is(deleted_at)
      return {
        eq: vi.fn(() => ({
          is: vi.fn(() => Promise.resolve({ data: wikilinkedPosts, error: null })),
        })),
      }
    }),
  }
}

/**
 * Build the users handler — for author username lookup.
 */
function usersHandler(username: string) {
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

/**
 * Build the post_versions handler.
 */
function postVersionsHandler(existingVersions: Array<{ version_no: number }> = []) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() =>
        Promise.resolve({ data: existingVersions, error: null }),
      ),
    })),
    insert: vi.fn((rows: unknown) => {
      capturedOps.push({ table: 'post_versions', op: 'insert', payload: rows })
      return Promise.resolve({ data: null, error: null })
    }),
  }
}

/**
 * Build the posts update handler.
 */
function postsUpdateHandler() {
  return {
    update: vi.fn((payload: unknown) => ({
      eq: vi.fn((_field: string, _val: unknown) => {
        capturedOps.push({ table: 'posts', op: 'update', payload })
        return Promise.resolve({ data: null, error: null })
      }),
    })),
  }
}

/**
 * Build the next_auth users handler for github_login lookup.
 */
function naSchemaHandler(githubLogin: string) {
  return {
    schema: vi.fn(() => ({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({ data: { github_login: githubLogin }, error: null }),
            ),
          })),
        })),
      })),
    })),
  }
}

/**
 * Build a full happy-path fake client.
 */
function makeHappyClient(opts: {
  postRow?: typeof EXISTING_POST | null
  existingVersions?: Array<{ version_no: number }>
  existingTags?: string[]
  authorUsername?: string
  githubLogin?: string
  wikilinkedPosts?: unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tableOverrides?: Record<string, any>
} = {}) {
  const {
    postRow = EXISTING_POST,
    existingVersions = [{ version_no: 1 }],
    existingTags = [],
    authorUsername = 'alice',
    githubLogin = 'alice-gh',
    wikilinkedPosts = [],
    tableOverrides = {},
  } = opts

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, any> = {
    posts: {
      ...postsHandler({ postRow, wikilinkedPosts }),
      ...postsUpdateHandler(),
    },
    users: usersHandler(authorUsername),
    tags: tagsHandler(existingTags),
    post_versions: postVersionsHandler(existingVersions),
    post_references: deleteOnlyHandler('post_references'),
    post_tags: deleteOnlyHandler('post_tags'),
    ...tableOverrides,
  }

  return {
    from: vi.fn((table: string) => handlers[table] ?? {}),
    schema: vi.fn((_schemaName: string) => ({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({ data: { github_login: githubLogin }, error: null }),
            ),
          })),
        })),
      })),
    })),
  }
}

// ---------------------------------------------------------------------------
// Request factory + shared payload
// ---------------------------------------------------------------------------
const VALID_BODY_MD = 'a'.repeat(60)
const VALID_PATCH_PAYLOAD = {
  title: 'Updated Title',
  summary: 'An updated summary here.',
  body_md: VALID_BODY_MD,
  tags: ['rag'],
}

function makeRequest(postId: string, body: unknown) {
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
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/posts/[id] — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeHappyClient()
  })

  it('returns 401 when no session', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(makeRequest('post-abc', {}) as never, makeContext('post-abc'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })
})

describe('PATCH /api/posts/[id] — 404 post not found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeHappyClient({ postRow: null })
  })

  it('returns 404 when post does not exist', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('nonexistent', VALID_PATCH_PAYLOAD) as never,
      makeContext('nonexistent'),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('returns 404 when post is already deleted', async () => {
    const deletedPost = { ...EXISTING_POST, deleted_at: '2026-01-01T00:00:00Z' }
    currentFakeClient = makeHappyClient({ postRow: deletedPost })
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', VALID_PATCH_PAYLOAD) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('PATCH /api/posts/[id] — 403 not author + not admin', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'other-user' } }
    isAdminState.value = false
    capturedOps.length = 0
    // Post is authored by 'user-123', but session is 'other-user' and not admin
    currentFakeClient = makeHappyClient({ githubLogin: 'other-gh' })
  })

  it('returns 403 when requestor is neither author nor admin', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', VALID_PATCH_PAYLOAD) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })
})

describe('PATCH /api/posts/[id] — 400 body with type field', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeHappyClient()
  })

  it('returns 400 invalid_body when type field is present in body', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const bodyWithType = { ...VALID_PATCH_PAYLOAD, type: 'post' }
    const res = await PATCH(
      makeRequest('post-abc', bodyWithType) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })
})

describe('PATCH /api/posts/[id] — admin can edit any post', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'admin-user' } }
    isAdminState.value = true
    capturedOps.length = 0
    // admin-user is NOT the author (post.author_id = 'user-123') but isAdmin returns true
    currentFakeClient = makeHappyClient({ githubLogin: 'admin-gh' })
  })

  it('allows admin (non-author) to edit any post and returns 200', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', VALID_PATCH_PAYLOAD) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('post-abc')
    expect(body.slug).toBe('my-post')
  })
})

describe('PATCH /api/posts/[id] — happy path: author edits own post', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeHappyClient({
      existingVersions: [{ version_no: 1 }],
    })
  })

  it('returns 200 with { id, slug, url }', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', VALID_PATCH_PAYLOAD) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('post-abc')
    expect(body.slug).toBe('my-post')
    expect(body.url).toBe('/alice/post/my-post')
  })

  it('snapshots PRIOR body_md into post_versions (not the new body)', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const newBodyMd = 'b'.repeat(60)
    const res = await PATCH(
      makeRequest('post-abc', { ...VALID_PATCH_PAYLOAD, body_md: newBodyMd }) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)

    const versionOp = capturedOps.find(
      (op) => op.table === 'post_versions' && op.op === 'insert',
    )
    expect(versionOp).toBeDefined()
    const rows = versionOp!.payload as Array<{ body_md: string; version_no: number }>
    expect(rows).toHaveLength(1)
    // Should snapshot the PRIOR body_md, not the new one
    expect(rows[0].body_md).toBe(EXISTING_POST.body_md)
    expect(rows[0].body_md).not.toBe(newBodyMd)
    // version_no should be MAX(existing) + 1 = 1 + 1 = 2
    expect(rows[0].version_no).toBe(2)
  })

  it('replaces post_tags: deletes existing then inserts new', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', { ...VALID_PATCH_PAYLOAD, tags: ['rag', 'llm'] }) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)

    // Should have a delete op for post_tags
    const tagsDeleteOp = capturedOps.find(
      (op) => op.table === 'post_tags' && op.op === 'delete',
    )
    expect(tagsDeleteOp).toBeDefined()

    // Should have an insert op for post_tags
    const tagsInsertOp = capturedOps.find(
      (op) => op.table === 'post_tags' && op.op === 'insert',
    )
    expect(tagsInsertOp).toBeDefined()
    const rows = tagsInsertOp!.payload as Array<{ post_id: string; tag_slug: string }>
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.tag_slug).sort()).toEqual(['llm', 'rag'])
  })

  it('replaces post_references: deletes existing then inserts new resolved rows', async () => {
    const wikilinkedPost = {
      id: 'target-id',
      author_id: 'other',
      slug: 'agent-memory',
      type: 'playbook',
      published_at: '2026-01-01T00:00:00Z',
      users: { username: 'bob' },
      likes: [{ count: 5 }],
    }

    currentFakeClient = makeHappyClient({
      wikilinkedPosts: [wikilinkedPost],
    })

    const bodyWithWikilink = `${VALID_BODY_MD}\nsee [[Agent Memory]]`
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', { ...VALID_PATCH_PAYLOAD, body_md: bodyWithWikilink }) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)

    // Delete then insert post_references
    const refsDeleteOp = capturedOps.find(
      (op) => op.table === 'post_references' && op.op === 'delete',
    )
    expect(refsDeleteOp).toBeDefined()

    const refsInsertOp = capturedOps.find(
      (op) => op.table === 'post_references' && op.op === 'insert',
    )
    expect(refsInsertOp).toBeDefined()
    const rows = refsInsertOp!.payload as Array<{
      source_post_id: string
      target_post_id: string
      target_slug: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].target_post_id).toBe('target-id')
    expect(rows[0].target_slug).toBe('agent-memory')
  })

  it('sets edited_at in the UPDATE payload', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', VALID_PATCH_PAYLOAD) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)

    const updateOp = capturedOps.find(
      (op) => op.table === 'posts' && op.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    expect(typeof payload.edited_at).toBe('string')
    // Verify it's a valid ISO timestamp
    expect(new Date(payload.edited_at as string).getTime()).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Tests — revalidateTag cache invalidation (Phase B discovery-cache contract)
// ---------------------------------------------------------------------------
describe('PATCH /api/posts/[id] — revalidateTag cache invalidation', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    isAdminState.value = false
    capturedOps.length = 0
    revalidateTagMock.mockReset()
    currentFakeClient = makeHappyClient({ existingVersions: [{ version_no: 1 }] })
  })

  it('calls revalidateTag("posts", { expire: 0 }) after successful edit', async () => {
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', VALID_PATCH_PAYLOAD) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)

    expect(revalidateTagMock).toHaveBeenCalledWith('posts', { expire: 0 })
  })

  it('calls revalidateTag("tags", { expire: 0 }) when PATCH creates a new tag slug', async () => {
    // 'rag' exists, 'brand-new-edit-tag' does not
    currentFakeClient = makeHappyClient({
      existingVersions: [{ version_no: 1 }],
      existingTags: ['rag'],
    })
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', { ...VALID_PATCH_PAYLOAD, tags: ['rag', 'brand-new-edit-tag'] }) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)

    expect(revalidateTagMock).toHaveBeenCalledWith('tags', { expire: 0 })
  })

  it('does NOT call revalidateTag when PATCH fails with 401', async () => {
    sessionState.value = null
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', VALID_PATCH_PAYLOAD) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(401)

    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('does NOT call revalidateTag when PATCH fails with 403', async () => {
    sessionState.value = { user: { id: 'other-user' } }
    isAdminState.value = false
    const { PATCH } = await import('@/app/api/posts/[id]/route')
    const res = await PATCH(
      makeRequest('post-abc', VALID_PATCH_PAYLOAD) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(403)

    expect(revalidateTagMock).not.toHaveBeenCalled()
  })
})
