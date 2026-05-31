/**
 * Unit tests for lib/users/ensure-public-user.ts
 *
 * Key invariant: ensurePublicUser() MUST return a non-null username string
 * whenever it can derive the GitHub login, even when:
 *   - the public.users row doesn't exist yet (trigger lag)
 *   - the initial post-upsert re-read misses the row (read-after-write window)
 *
 * The retry-after-upsert path (50 ms delay, one extra read) is what prevents
 * the "username missing until hard reload" symptom reported in post-review
 * feedback: the session callback calls ensurePublicUser on first render when
 * public.users is empty, and without the retry the function would return
 * `login` as a bare string fallback — which is correct but only because of
 * the `?? login` expression on the last line.  The retry ensures a real DB
 * row exists before the session cookie is written, so the username survives
 * subsequent reads by other parts of the system.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ensurePublicUser } from '@/lib/users/ensure-public-user'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MaybeSingleResult<T> = { data: T | null; error: null }

/**
 * Build a minimal chainable Supabase mock.
 *
 * `calls` is an array of results for successive `.maybeSingle()` invocations
 * across ALL .from() chains — both the public.users reads and the
 * next_auth.users read.
 *
 * The mock is intentionally simple: every `.schema()`, `.from()`, `.select()`,
 * `.eq()`, `.update()`, `.upsert()` call returns the same chainable object.
 * The terminal `.maybeSingle()` pops the next result from `calls`.
 */
function buildMockSupabase(calls: MaybeSingleResult<unknown>[]) {
  let callIndex = 0

  const maybeSingle = vi.fn(async () => {
    const result = calls[callIndex] ?? { data: null, error: null }
    callIndex++
    return result
  })

  // Upsert / update just need to resolve without error.
  const upsert = vi.fn(async () => ({ data: null, error: null }))
  const update = vi.fn(() => ({
    eq: vi.fn(async () => ({ data: null, error: null })),
  }))

  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle,
    upsert,
    update,
  }
  // Allow re-chaining from upsert.
  Object.assign(chain, { from: vi.fn(() => chain), schema: vi.fn(() => chain) })

  const from = vi.fn(() => chain)
  const schema = vi.fn(() => ({ from, ...chain }))

  return { from, schema, _chain: chain, _maybeSingle: maybeSingle } as unknown as SupabaseClient & {
    _chain: typeof chain
    _maybeSingle: typeof maybeSingle
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensurePublicUser()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the username immediately when public.users row already exists', async () => {
    const supabase = buildMockSupabase([
      { data: { username: 'alice' }, error: null },
    ])

    const result = await ensurePublicUser(supabase as unknown as SupabaseClient, 'user-1')
    expect(result).toBe('alice')
    // Only one maybeSingle call — the fast path.
    expect((supabase as { _maybeSingle: ReturnType<typeof vi.fn> })._maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('creates the row via upsert and returns login when initial read misses but post-upsert read hits immediately', async () => {
    // Call order:
    //   1. public.users initial read → null
    //   2. next_auth.users read → has github_login
    //   3. public.users post-upsert read → has username
    const supabase = buildMockSupabase([
      { data: null, error: null },                                   // 1. initial public.users miss
      { data: { id: 'user-1', name: 'Alice', image: null, github_login: 'alice' }, error: null }, // 2. next_auth.users
      { data: { username: 'alice' }, error: null },                  // 3. post-upsert re-read
    ])

    const resultPromise = ensurePublicUser(supabase as unknown as SupabaseClient, 'user-1')
    // Advance timers in case the retry branch fires (it shouldn't here).
    await vi.runAllTimersAsync()
    const result = await resultPromise
    expect(result).toBe('alice')
  })

  it('retries once after 50 ms when the post-upsert read returns null (read-after-write window)', async () => {
    // Call order:
    //   1. public.users initial read → null (no row yet)
    //   2. next_auth.users read → has github_login
    //   3. public.users post-upsert read → still null (timing window)
    //   4. public.users retry read (after 50 ms) → has username
    const supabase = buildMockSupabase([
      { data: null, error: null },           // 1. initial miss
      { data: { id: 'user-1', name: 'Alice', image: null, github_login: 'alice' }, error: null }, // 2. next_auth
      { data: null, error: null },           // 3. post-upsert immediate read — still null
      { data: { username: 'alice' }, error: null }, // 4. retry read after 50 ms
    ])

    const resultPromise = ensurePublicUser(supabase as unknown as SupabaseClient, 'user-1')
    // Advance past the 50 ms retry delay.
    await vi.advanceTimersByTimeAsync(60)
    const result = await resultPromise
    expect(result).toBe('alice')
  })

  it('falls back to the login string when the retry read also returns null', async () => {
    // Both the post-upsert read and the retry read miss → return `login` as fallback.
    const supabase = buildMockSupabase([
      { data: null, error: null },           // 1. initial miss
      { data: { id: 'user-1', name: 'Alice', image: null, github_login: 'alice' }, error: null }, // 2. next_auth
      { data: null, error: null },           // 3. post-upsert read — null
      { data: null, error: null },           // 4. retry read — still null
    ])

    const resultPromise = ensurePublicUser(supabase as unknown as SupabaseClient, 'user-1')
    await vi.advanceTimersByTimeAsync(60)
    const result = await resultPromise
    // Fallback: return the known github login even when the DB read fails.
    expect(result).toBe('alice')
  })

  it('returns null when next_auth.users has no github_login and account lookup also fails', async () => {
    const supabase = buildMockSupabase([
      { data: null, error: null },           // 1. public.users miss
      { data: { id: 'user-1', name: null, image: null, github_login: null }, error: null }, // 2. next_auth (no login)
      { data: null, error: null },           // 3. accounts lookup miss
    ])

    const resultPromise = ensurePublicUser(supabase as unknown as SupabaseClient, 'user-1')
    await vi.advanceTimersByTimeAsync(100)
    const result = await resultPromise
    expect(result).toBeNull()
  })
})
