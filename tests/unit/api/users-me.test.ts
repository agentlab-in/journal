import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: @/lib/auth
// ---------------------------------------------------------------------------
const sessionState: { value: { user: { id: string } } | null } = { value: null }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
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
// Captured operations
// ---------------------------------------------------------------------------
interface CapturedUpdate {
  payload: Record<string, unknown>
  filterField: string
  filterValue: unknown
}

const capturedUpdates: CapturedUpdate[] = []

const USER_ID = '11111111-1111-4111-8111-111111111111'

interface UsersRow {
  id: string
  bio: string | null
  avatar_url: string | null
  updated_at: string
}

function makeUsersHandler(row: UsersRow) {
  const currentRow: UsersRow = { ...row }
  return {
    update: vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn((field: string, value: unknown) => ({
        select: vi.fn(() => ({
          single: vi.fn(() => {
            capturedUpdates.push({ payload, filterField: field, filterValue: value })
            if ('bio' in payload) currentRow.bio = payload.bio as string | null
            if ('avatar_url' in payload) {
              currentRow.avatar_url = payload.avatar_url as string | null
            }
            currentRow.updated_at = new Date().toISOString()
            return Promise.resolve({ data: { ...currentRow }, error: null })
          }),
        })),
      })),
    })),
  }
}

function makeClient(row: UsersRow) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'users') return makeUsersHandler(row)
      return {}
    }),
  }
}

function makeRequest(body: unknown, opts: { raw?: boolean } = {}) {
  return new Request('http://test/api/users/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3010',
    },
    body: opts.raw ? (body as string) : JSON.stringify(body),
  })
}

const BASE_ROW: UsersRow = {
  id: USER_ID,
  bio: null,
  avatar_url: null,
  updated_at: '2026-01-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/users/me — 401 unauthenticated', () => {
  beforeEach(() => {
    sessionState.value = null
    capturedUpdates.length = 0
    currentFakeClient = makeClient(BASE_ROW)
  })

  it('returns 401 when no session', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({ bio: 'hi' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })
})

describe('PATCH /api/users/me — 400 invalid body', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedUpdates.length = 0
    currentFakeClient = makeClient(BASE_ROW)
  })

  it('returns 400 no_fields when body is empty object', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('no_fields')
    expect(capturedUpdates).toHaveLength(0)
  })

  it('returns 400 invalid_body when an unknown field is present', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({ display_name: 'Hacker' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
    expect(capturedUpdates).toHaveLength(0)
  })

  it('returns 400 invalid_body when username is in the body', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({ username: 'eve' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 invalid_body when bio exceeds 2000 chars', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({ bio: 'a'.repeat(2001) }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 invalid_body when avatar_url is not https', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(
      makeRequest({ avatar_url: 'http://example.com/a.webp' }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 invalid_json on malformed JSON', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest('not json{', { raw: true }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_json')
  })
})

describe('PATCH /api/users/me — happy paths', () => {
  beforeEach(() => {
    sessionState.value = { user: { id: USER_ID } }
    capturedUpdates.length = 0
    currentFakeClient = makeClient(BASE_ROW)
  })

  it('updates bio only and returns 200 with the new row', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({ bio: 'hello world' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(USER_ID)
    expect(body.bio).toBe('hello world')
    expect(capturedUpdates).toHaveLength(1)
    expect(capturedUpdates[0].payload.bio).toBe('hello world')
    expect('avatar_url' in capturedUpdates[0].payload).toBe(false)
  })

  it('updates avatar_url only and returns 200 with the new row', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(
      makeRequest({ avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.avatar_url).toBe('https://avatars.githubusercontent.com/u/12345?v=4')
    expect(capturedUpdates).toHaveLength(1)
    expect(capturedUpdates[0].payload.avatar_url).toBe(
      'https://avatars.githubusercontent.com/u/12345?v=4',
    )
    expect('bio' in capturedUpdates[0].payload).toBe(false)
  })

  it('updates both fields when both are provided', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(
      makeRequest({
        bio: 'About me.',
        avatar_url: 'https://avatars.githubusercontent.com/u/67890',
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bio).toBe('About me.')
    expect(body.avatar_url).toBe('https://avatars.githubusercontent.com/u/67890')
    expect(capturedUpdates[0].payload.bio).toBe('About me.')
    expect(capturedUpdates[0].payload.avatar_url).toBe(
      'https://avatars.githubusercontent.com/u/67890',
    )
  })

  it('allows null to clear bio', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({ bio: null }))
    expect(res.status).toBe(200)
    expect(capturedUpdates[0].payload.bio).toBeNull()
  })

  it('allows null to clear avatar_url', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({ avatar_url: null }))
    expect(res.status).toBe(200)
    expect(capturedUpdates[0].payload.avatar_url).toBeNull()
  })

  it('coerces an empty-string avatar_url to NULL on persist', async () => {
    // An empty string would otherwise reach <Image> as `src=""` and break
    // the profile render. Stored as NULL so the `?? '/icon.png'` fallback
    // kicks in everywhere.
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({ avatar_url: '' }))
    expect(res.status).toBe(200)
    expect(capturedUpdates[0].payload.avatar_url).toBeNull()
  })

  it('scopes the UPDATE to the session user id', async () => {
    const { PATCH } = await import('@/app/api/users/me/route')
    const res = await PATCH(makeRequest({ bio: 'scoped' }))
    expect(res.status).toBe(200)
    expect(capturedUpdates[0].filterField).toBe('id')
    expect(capturedUpdates[0].filterValue).toBe(USER_ID)
  })
})
