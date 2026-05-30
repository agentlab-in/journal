import { describe, it, expect, vi } from 'vitest'
import { getFollowState } from '@/lib/profile/follow-state'

type SingleResult = {
  data: Record<string, unknown> | null
  error: unknown
}

function makeChain(result: SingleResult) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

function makeClient(chain: ReturnType<typeof makeChain>) {
  return { from: vi.fn(() => chain) }
}

describe('getFollowState', () => {
  it('returns false without a DB call when viewerUserId is null (anon)', async () => {
    const chain = makeChain({ data: { follower_id: 'x' }, error: null })
    const db = makeClient(chain)
    const result = await getFollowState({
      admin: db as never,
      targetUserId: 'user-1',
      viewerUserId: null,
    })
    expect(result).toBe(false)
    expect(db.from).not.toHaveBeenCalled()
  })

  it('returns false without a DB call when viewerUserId is undefined (anon)', async () => {
    const chain = makeChain({ data: { follower_id: 'x' }, error: null })
    const db = makeClient(chain)
    const result = await getFollowState({
      admin: db as never,
      targetUserId: 'user-1',
      viewerUserId: undefined,
    })
    expect(result).toBe(false)
    expect(db.from).not.toHaveBeenCalled()
  })

  it('returns false without a DB call when viewer === target (self)', async () => {
    const chain = makeChain({ data: { follower_id: 'x' }, error: null })
    const db = makeClient(chain)
    const result = await getFollowState({
      admin: db as never,
      targetUserId: 'user-1',
      viewerUserId: 'user-1',
    })
    expect(result).toBe(false)
    expect(db.from).not.toHaveBeenCalled()
  })

  it('returns true when a follows row exists', async () => {
    const chain = makeChain({
      data: { follower_id: 'viewer-1' },
      error: null,
    })
    const db = makeClient(chain)
    const result = await getFollowState({
      admin: db as never,
      targetUserId: 'user-1',
      viewerUserId: 'viewer-1',
    })
    expect(result).toBe(true)
    expect(db.from).toHaveBeenCalledWith('follows')
    expect(chain.eq).toHaveBeenCalledWith('follower_id', 'viewer-1')
    expect(chain.eq).toHaveBeenCalledWith('followed_id', 'user-1')
  })

  it('returns false when no row matches', async () => {
    const chain = makeChain({ data: null, error: null })
    const db = makeClient(chain)
    const result = await getFollowState({
      admin: db as never,
      targetUserId: 'user-1',
      viewerUserId: 'viewer-1',
    })
    expect(result).toBe(false)
  })

  it('returns false (fail-safe) when Supabase returns an error', async () => {
    const chain = makeChain({ data: null, error: { message: 'boom' } })
    const db = makeClient(chain)
    const result = await getFollowState({
      admin: db as never,
      targetUserId: 'user-1',
      viewerUserId: 'viewer-1',
    })
    expect(result).toBe(false)
  })
})
