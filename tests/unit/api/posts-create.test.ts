import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
  isAdmin: vi.fn(() => false),
}))

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/admin
// The factory is mutable — each test assigns a new client via `setFakeClient`.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentFakeClient),
}))

// ---------------------------------------------------------------------------
// Captured inserts for assertion in happy-path tests.
// ---------------------------------------------------------------------------
interface InsertRecord { table: string; rows: unknown }
const capturedInserts: InsertRecord[] = []

// ---------------------------------------------------------------------------
// Builder helpers — create partial chainable stubs per table.
// ---------------------------------------------------------------------------

/**
 * Build a table handler for `public.users` that returns a known username.
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
 * Build a table handler for `public.posts` that handles:
 *  - SELECT slug for slug-collision check (via .eq.in)
 *  - SELECT for wikilink resolve (via .eq.is)
 *  - INSERT (returns new post row with given id)
 */
function postsHandler(opts: {
  takenSlugs?: string[]
  newPostId?: string
}) {
  return {
    select: vi.fn((cols: string) => {
      // slug-collision: select('slug').eq('author_id', ...).in('slug', ...)
      if (cols === 'slug') {
        const taken = opts.takenSlugs ?? []
        return {
          eq: vi.fn(() => ({
            in: vi.fn((_col: string, vals: string[]) =>
              Promise.resolve({
                data: vals.filter((v) => taken.includes(v)).map((slug) => ({ slug })),
                error: null,
              }),
            ),
          })),
        }
      }
      // wikilink resolve: select('id, author_id, slug, type, published_at, like_count, users!inner(username)').eq(...).is(...)
      return {
        eq: vi.fn(() => ({
          is: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      }
    }),
    insert: vi.fn((rows: unknown) => {
      capturedInserts.push({ table: 'posts', rows })
      const id = opts.newPostId ?? 'new-post-id'
      return {
        select: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({ data: { id }, error: null }),
          ),
        })),
      }
    }),
  }
}

/**
 * Build a handler for `public.tags` that returns existing tags by slug.
 */
function tagsHandler(existingTagSlugs: string[]) {
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
      capturedInserts.push({ table: 'tags', rows })
      return Promise.resolve({ data: null, error: null })
    }),
  }
}

/**
 * Build a no-op insert handler for a table (post_tags, post_versions, post_references).
 */
function insertOnlyHandler(table: string) {
  return {
    insert: vi.fn((rows: unknown) => {
      capturedInserts.push({ table, rows })
      return Promise.resolve({ data: null, error: null })
    }),
  }
}

/**
 * Build a full "happy path" fake client where every operation succeeds.
 */
function makeHappyClient(opts: {
  username?: string
  takenSlugs?: string[]
  existingTags?: string[]
  newPostId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tableOverrides?: Record<string, any>
} = {}) {
  const {
    username = 'alice',
    takenSlugs = [],
    existingTags = [],
    newPostId = 'post-id-123',
    tableOverrides = {},
  } = opts

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, any> = {
    users: usersHandler(username),
    posts: postsHandler({ takenSlugs, newPostId }),
    tags: tagsHandler(existingTags),
    post_tags: insertOnlyHandler('post_tags'),
    post_versions: insertOnlyHandler('post_versions'),
    post_references: insertOnlyHandler('post_references'),
    ...tableOverrides,
  }

  return {
    from: vi.fn((table: string) => {
      return handlers[table] ?? {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } })),
            in: vi.fn(() => Promise.resolve({ data: [], error: null })),
            is: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        insert: vi.fn((rows: unknown) => {
          capturedInserts.push({ table, rows })
          return Promise.resolve({ data: null, error: null })
        }),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Request factory + shared payload
// ---------------------------------------------------------------------------
const VALID_BODY_MD = 'a'.repeat(60)
const VALID_POST_PAYLOAD = {
  type: 'post',
  title: 'My Test Post',
  summary: 'A valid summary here.',
  body_md: VALID_BODY_MD,
  tags: ['rag'],
}

function makeRequest(body: unknown) {
  return new Request('http://test/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests — 401 (no session)
// ---------------------------------------------------------------------------
describe('POST /api/posts — 401 (no session)', () => {
  beforeEach(() => {
    sessionState.value = null
    capturedInserts.length = 0
    currentFakeClient = makeHappyClient()
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({})
    const res = await POST(req as never)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })
})

// ---------------------------------------------------------------------------
// Tests — 400 Zod body validation
// ---------------------------------------------------------------------------
describe('POST /api/posts — 400 Zod body validation', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    capturedInserts.length = 0
    currentFakeClient = makeHappyClient()
  })

  it('returns 400 with invalid_body when summary is too long', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({ ...VALID_POST_PAYLOAD, summary: 'x'.repeat(201) })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
    expect(Array.isArray(body.issues)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests — 400 cover_image_url prefix check
// ---------------------------------------------------------------------------
describe('POST /api/posts — 400 cover_image_url prefix check', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    capturedInserts.length = 0
    currentFakeClient = makeHappyClient()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
  })

  it('returns 400 when cover_image_url is not from covers bucket', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({
      ...VALID_POST_PAYLOAD,
      cover_image_url: 'https://evil.example/storage/v1/object/public/covers/x.webp',
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_cover_url')
  })
})

// ---------------------------------------------------------------------------
// Tests — 400 missing_sections for playbook/dive
// ---------------------------------------------------------------------------
describe('POST /api/posts — 400 missing_sections for playbook/dive', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    capturedInserts.length = 0
    currentFakeClient = makeHappyClient()
  })

  it('returns 400 when playbook is missing required sections', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({
      type: 'playbook',
      title: 'My Playbook',
      summary: 'A valid summary.',
      body_md: '# Intro\nNo structured sections here.',
      tags: ['rag'],
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('missing_sections')
    expect(typeof body.detail).toBe('string')
  })

  it('returns 400 when dive is missing required sections', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({
      type: 'dive',
      title: 'My Deep Dive',
      summary: 'A valid summary.',
      body_md: '# Intro\nNo TL;DR or The Question here.',
      tags: ['rag'],
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('missing_sections')
  })
})

// ---------------------------------------------------------------------------
// Tests — 400 reserved slug
// ---------------------------------------------------------------------------
describe('POST /api/posts — 400 reserved slug', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    capturedInserts.length = 0
    currentFakeClient = makeHappyClient()
  })

  it('returns 400 when post title slugifies to a reserved name', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({
      ...VALID_POST_PAYLOAD,
      title: 'admin', // 'admin' is a reserved slug
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('reserved_slug')
  })
})

// ---------------------------------------------------------------------------
// Tests — slug suffixing (findUniqueSlug)
// ---------------------------------------------------------------------------
describe('POST /api/posts — slug suffixing', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    capturedInserts.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
  })

  it('suffixes slug to -2 when base slug is already taken by same author', async () => {
    // 'my-test-post' is taken → should use 'my-test-post-2'
    currentFakeClient = makeHappyClient({ takenSlugs: ['my-test-post'], newPostId: 'p-slug-test' })
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest(VALID_POST_PAYLOAD)
    const res = await POST(req as never)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.slug).toBe('my-test-post-2')
  })
})

// ---------------------------------------------------------------------------
// Tests — reserved new-tag slugs → 400
// ---------------------------------------------------------------------------
describe('POST /api/posts — reserved tag slug', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    capturedInserts.length = 0
    currentFakeClient = makeHappyClient()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
  })

  it('returns 400 when a new tag slug shadows a reserved name', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({
      ...VALID_POST_PAYLOAD,
      tags: ['admin'], // 'admin' is reserved
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('reserved_tag_slug')
  })
})

// ---------------------------------------------------------------------------
// Tests — new pending tag rows inserted
// ---------------------------------------------------------------------------
describe('POST /api/posts — new pending tags', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    capturedInserts.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
  })

  it('inserts is_approved=false rows for new (unknown) tags', async () => {
    // 'rag' exists, 'new-tag' does not → 'new-tag' should be inserted pending
    currentFakeClient = makeHappyClient({ existingTags: ['rag'] })
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({ ...VALID_POST_PAYLOAD, tags: ['rag', 'new-tag'] })
    const res = await POST(req as never)
    expect(res.status).toBe(201)
    const tagInsert = capturedInserts.find((r) => r.table === 'tags')
    expect(tagInsert).toBeDefined()
    const rows = tagInsert!.rows as Array<{ slug: string; is_approved: boolean }>
    expect(rows).toHaveLength(1)
    expect(rows[0].slug).toBe('new-tag')
    expect(rows[0].is_approved).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests — post_references written for resolved wikilinks
// ---------------------------------------------------------------------------
describe('POST /api/posts — post_references on resolved wikilinks', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    capturedInserts.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
  })

  it('inserts post_references rows for each resolved anchor', async () => {
    // body_md has a wikilink [[Agent Memory]] that resolves to a known post
    const bodyWithWikilink = `${VALID_BODY_MD}\n\nsee [[Agent Memory]] for context`

    // Override the posts handler to resolve the wikilink
    const resolvedPost = {
      id: 'target-post-id',
      author_id: 'other-user',
      slug: 'agent-memory',
      type: 'playbook',
      published_at: '2026-01-01T00:00:00Z',
      users: { username: 'bob' },
      likes: [{ count: 5 }],
    }

    // Build a posts handler that handles both slug-collision (select slug) and wikilink resolve
    const customPostsHandler = {
      select: vi.fn((cols: string) => {
        if (cols === 'slug') {
          // slug collision check
          return {
            eq: vi.fn(() => ({
              in: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          }
        }
        // wikilink resolve query
        return {
          eq: vi.fn(() => ({
            is: vi.fn(() => Promise.resolve({ data: [resolvedPost], error: null })),
          })),
        }
      }),
      insert: vi.fn((rows: unknown) => {
        capturedInserts.push({ table: 'posts', rows })
        return {
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({ data: { id: 'new-post-id' }, error: null }),
            ),
          })),
        }
      }),
    }

    currentFakeClient = makeHappyClient({
      tableOverrides: { posts: customPostsHandler },
    })

    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({ ...VALID_POST_PAYLOAD, body_md: bodyWithWikilink })
    const res = await POST(req as never)
    expect(res.status).toBe(201)

    const refInsert = capturedInserts.find((r) => r.table === 'post_references')
    expect(refInsert).toBeDefined()
    const refRows = refInsert!.rows as Array<{
      source_post_id: string
      target_post_id: string
      target_slug: string
    }>
    expect(refRows).toHaveLength(1)
    expect(refRows[0].target_post_id).toBe('target-post-id')
    expect(refRows[0].target_slug).toBe('agent-memory')
  })
})

// ---------------------------------------------------------------------------
// Tests — happy path 201
// ---------------------------------------------------------------------------
describe('POST /api/posts — happy path 201', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    capturedInserts.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
    currentFakeClient = makeHappyClient({ username: 'alice', newPostId: 'post-id-happy' })
  })

  it('returns 201 with { id, slug, url } on valid create', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest(VALID_POST_PAYLOAD)
    const res = await POST(req as never)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('post-id-happy')
    expect(typeof body.slug).toBe('string')
    expect(body.url).toBe(`/alice/post/${body.slug}`)
  })

  it('inserts post_versions row with version_no=1 and correct body_md', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest(VALID_POST_PAYLOAD)
    await POST(req as never)

    const versionsInsert = capturedInserts.find((r) => r.table === 'post_versions')
    expect(versionsInsert).toBeDefined()
    const rows = versionsInsert!.rows as Array<{ post_id: string; version_no: number; body_md: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].version_no).toBe(1)
    expect(rows[0].body_md).toBe(VALID_BODY_MD)
    expect(rows[0].post_id).toBe('post-id-happy')
  })

  it('inserts post_tags rows for each tag', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = makeRequest({ ...VALID_POST_PAYLOAD, tags: ['rag', 'llm'] })
    await POST(req as never)

    const tagsInsert = capturedInserts.find((r) => r.table === 'post_tags')
    expect(tagsInsert).toBeDefined()
    const rows = tagsInsert!.rows as Array<{ post_id: string; tag_slug: string }>
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.tag_slug).sort()).toEqual(['llm', 'rag'])
    expect(rows[0].post_id).toBe('post-id-happy')
  })
})
