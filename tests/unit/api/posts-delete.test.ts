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
// Shared test fixtures
// ---------------------------------------------------------------------------
const EXISTING_POST = {
  id: 'post-abc',
  author_id: 'user-123',
  slug: 'test-post-slug',
  deleted_at: null,
}

const DELETED_POST = {
  id: 'post-abc',
  author_id: 'user-123',
  slug: 'test-post-slug',
  deleted_at: '2026-01-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/**
 * Build posts handler for DELETE — only needs select (single) + update.
 */
function postsHandler(postRow: typeof EXISTING_POST | typeof DELETED_POST | null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve(
            postRow
              ? { data: postRow, error: null }
              : { data: null, error: { message: 'not found' } },
          ),
        ),
      })),
    })),
    update: vi.fn((payload: unknown) => ({
      eq: vi.fn((_field: string, _val: unknown) => {
        capturedOps.push({ table: 'posts', op: 'update', payload })
        return Promise.resolve({ data: null, error: null })
      }),
    })),
  }
}

/**
 * Build mod_actions handler — insert stub that records the op.
 */
function modActionsHandler(opts: { insertError?: { message: string } | null } = {}) {
  const { insertError = null } = opts
  return {
    insert: vi.fn((payload: unknown) => {
      capturedOps.push({ table: 'mod_actions', op: 'insert', payload })
      return Promise.resolve({ data: null, error: insertError })
    }),
  }
}

/**
 * Build a full fake client for DELETE tests.
 */
function makeDeleteClient(opts: {
  postRow?: typeof EXISTING_POST | typeof DELETED_POST | null
  githubLogin?: string
  modActionsInsertError?: { message: string } | null
} = {}) {
  const { postRow = EXISTING_POST, githubLogin = 'user-gh', modActionsInsertError = null } = opts

  return {
    from: vi.fn((table: string) => {
      if (table === 'posts') return postsHandler(postRow)
      if (table === 'mod_actions') return modActionsHandler({ insertError: modActionsInsertError })
      // Default: no-op stub
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } })),
          })),
        })),
      }
    }),
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
// Request factory
// ---------------------------------------------------------------------------

function makeRequest(postId: string, body?: string) {
  return new Request(`http://test/api/posts/${postId}`, {
    method: 'DELETE',
    headers: { Origin: 'http://localhost:3010' },
    body: body ?? undefined,
  })
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DELETE /api/posts/[id] — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient()
  })

  it('returns 401 when no session', async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })
})

describe('DELETE /api/posts/[id] — 404 post not found', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    isAdminState.value = false
    capturedOps.length = 0
  })

  it('returns 404 when post does not exist', async () => {
    currentFakeClient = makeDeleteClient({ postRow: null })
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('nonexistent') as never, makeContext('nonexistent'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('returns 404 when post is already deleted', async () => {
    currentFakeClient = makeDeleteClient({ postRow: DELETED_POST })
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('DELETE /api/posts/[id] — 403 not author + not admin', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'other-user' } }
    isAdminState.value = false
    capturedOps.length = 0
    // post.author_id = 'user-123', session is 'other-user', isAdmin returns false
    currentFakeClient = makeDeleteClient({ githubLogin: 'other-gh' })
  })

  it('returns 403 when requestor is neither author nor admin', async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })
})

describe("DELETE /api/posts/[id] — deletion_reason='author' for author delete", () => {
  beforeEach(() => {
    // Session is the post author
    sessionState.value = { user: { id: 'user-123' } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient({ githubLogin: 'user-gh' })
  })

  it("sets deletion_reason='author' when author deletes their own post", async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })

    const updateOp = capturedOps.find(
      (op) => op.table === 'posts' && op.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    expect(payload.deletion_reason).toBe('author')
    expect(typeof payload.deleted_at).toBe('string')
  })

  it('does NOT insert a mod_actions row on author delete', async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))

    const modOp = capturedOps.find((op) => op.table === 'mod_actions')
    expect(modOp).toBeUndefined()
  })
})

describe("DELETE /api/posts/[id] — deletion_reason='moderation' for admin delete", () => {
  beforeEach(() => {
    // Session is an admin who is NOT the post author
    sessionState.value = { user: { id: 'admin-user' } }
    isAdminState.value = true
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient({ githubLogin: 'admin-gh' })
  })

  it("sets deletion_reason='moderation' when admin (non-author) deletes a post", async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })

    const updateOp = capturedOps.find(
      (op) => op.table === 'posts' && op.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    expect(payload.deletion_reason).toBe('moderation')
  })

  it('inserts a mod_actions row with correct fields on admin delete', async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(
      makeRequest('post-abc', JSON.stringify({ reason: 'spammy content' })) as never,
      makeContext('post-abc'),
    )
    expect(res.status).toBe(200)

    const modOp = capturedOps.find((op) => op.table === 'mod_actions' && op.op === 'insert')
    expect(modOp).toBeDefined()
    const modPayload = modOp!.payload as Record<string, unknown>
    expect(modPayload.mod_user_id).toBe('admin-user')
    expect(modPayload.action).toBe('delete_post')
    expect(modPayload.target_type).toBe('post')
    expect(modPayload.target_id).toBe('post-abc')
    expect(modPayload.reason).toBe('spammy content')
    expect(modPayload.metadata).toEqual({ slug: 'test-post-slug', author_id: 'user-123' })
  })

  it('inserts mod_actions row with reason=null when no body provided', async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(200)

    const modOp = capturedOps.find((op) => op.table === 'mod_actions' && op.op === 'insert')
    expect(modOp).toBeDefined()
    const modPayload = modOp!.payload as Record<string, unknown>
    expect(modPayload.reason).toBeNull()
  })

  it('returns 200 even when mod_actions insert fails (soft failure)', async () => {
    currentFakeClient = makeDeleteClient({
      githubLogin: 'admin-gh',
      modActionsInsertError: { message: 'insert error' },
    })
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    // Deletion succeeded; audit insert failed but we still return 200
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })
})

describe("DELETE /api/posts/[id] — admin who is also the author gets 'author' reason", () => {
  beforeEach(() => {
    // Session is both the post author AND an admin
    sessionState.value = { user: { id: 'user-123' } }
    isAdminState.value = true
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient({ githubLogin: 'admin-author-gh' })
  })

  it("sets deletion_reason='author' when admin IS the post author (author takes precedence)", async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(200)

    const updateOp = capturedOps.find(
      (op) => op.table === 'posts' && op.op === 'update',
    )
    expect(updateOp).toBeDefined()
    const payload = updateOp!.payload as Record<string, unknown>
    // Author path takes precedence even when admin
    expect(payload.deletion_reason).toBe('author')
  })

  it('does NOT insert mod_actions when author-admin deletes their own post', async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))

    const modOp = capturedOps.find((op) => op.table === 'mod_actions')
    expect(modOp).toBeUndefined()
  })
})

describe('DELETE /api/posts/[id] — does NOT touch comments/likes/bookmarks/tags/references', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    isAdminState.value = false
    capturedOps.length = 0
    currentFakeClient = makeDeleteClient({ githubLogin: 'user-gh' })
  })

  it('only performs the posts UPDATE — no deletes on related tables', async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(200)

    // Only one op should be captured: the posts update
    const touchedTables = capturedOps.map((op) => `${op.table}.${op.op}`)
    expect(touchedTables).toContain('posts.update')
    // These should NOT be touched
    expect(touchedTables).not.toContain('comments.delete')
    expect(touchedTables).not.toContain('likes.delete')
    expect(touchedTables).not.toContain('bookmarks.delete')
    expect(touchedTables).not.toContain('post_tags.delete')
    expect(touchedTables).not.toContain('post_references.delete')
  })
})

// ---------------------------------------------------------------------------
// Tests — revalidateTag cache invalidation (Phase B discovery-cache contract)
// ---------------------------------------------------------------------------
describe('DELETE /api/posts/[id] — revalidateTag cache invalidation', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    isAdminState.value = false
    capturedOps.length = 0
    revalidateTagMock.mockReset()
    currentFakeClient = makeDeleteClient({ githubLogin: 'user-gh' })
  })

  it('calls revalidateTag("posts", { expire: 0 }) after successful author soft-delete', async () => {
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(200)

    expect(revalidateTagMock).toHaveBeenCalledWith('posts', { expire: 0 })
  })

  it('does NOT call revalidateTag when DELETE fails with 401', async () => {
    sessionState.value = null
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(401)

    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('does NOT call revalidateTag when DELETE fails with 403', async () => {
    sessionState.value = { user: { id: 'other-user' } }
    isAdminState.value = false
    const { DELETE } = await import('@/app/api/posts/[id]/route')
    const res = await DELETE(makeRequest('post-abc') as never, makeContext('post-abc'))
    expect(res.status).toBe(403)

    expect(revalidateTagMock).not.toHaveBeenCalled()
  })
})
