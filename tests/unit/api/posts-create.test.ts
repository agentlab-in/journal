import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mocks must be set up before the route module is imported.
const sessionState: { value: { user: { id: string } } | null } = { value: null }
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
  isAdmin: vi.fn(() => false),
}))

// Minimal capture-friendly stub state. Each test configures it via makeFakeClient.
interface InsertRecord { table: string; rows: unknown }
const supabaseStub: { state: { inserts: InsertRecord[] } } = {
  state: { inserts: [] },
}

// Fake client factory — expanded one operation at a time as the route grows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeClient(state: { inserts: InsertRecord[] }, tableHandlers: Record<string, any> = {}) {
  return {
    from: vi.fn((table: string) => {
      if (tableHandlers[table]) return tableHandlers[table]
      // Default: accept inserts, return empty selects
      const insertFn = vi.fn((rows: unknown) => {
        state.inserts.push({ table, rows })
        return Promise.resolve({ data: null, error: null })
      })
      const selectFn = vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } })),
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          is: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      }))
      return {
        select: selectFn,
        insert: insertFn,
      }
    }),
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => makeFakeClient(supabaseStub.state)),
}))

// ---------------------------------------------------------------------------
// Helpers
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
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/posts — 401 (no session)', () => {
  beforeEach(() => {
    sessionState.value = null
    supabaseStub.state.inserts = []
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

describe('POST /api/posts — 400 Zod body validation', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    supabaseStub.state.inserts = []
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

describe('POST /api/posts — 400 cover_image_url prefix check', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    supabaseStub.state.inserts = []
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

describe('POST /api/posts — 400 missing_sections for playbook/dive', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    supabaseStub.state.inserts = []
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

describe('POST /api/posts — 400 reserved slug', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: 'user-123' } }
    supabaseStub.state.inserts = []
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
