import { describe, it, expect, vi } from 'vitest'
import { getNewCommentDepth } from '@/lib/comments/depth'
import type { SupabaseClient } from '@supabase/supabase-js'

function makeAdmin(rpcImpl: ReturnType<typeof vi.fn>) {
  return { rpc: rpcImpl } as unknown as SupabaseClient
}

describe('getNewCommentDepth', () => {
  it('returns 1 when parent is null (root comment)', async () => {
    const rpc = vi.fn()
    const admin = makeAdmin(rpc)
    await expect(getNewCommentDepth(admin, null)).resolves.toBe(1)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns parent_depth + 1 for a non-null parent', async () => {
    const rpc = vi.fn(async () => ({ data: 3, error: null }))
    const admin = makeAdmin(rpc)
    await expect(getNewCommentDepth(admin, 'parent-uuid')).resolves.toBe(4)
    expect(rpc).toHaveBeenCalledWith('comment_depth_for_parent', {
      p_parent: 'parent-uuid',
    })
  })

  it('returns 2 when parent is a root (depth 1)', async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }))
    const admin = makeAdmin(rpc)
    await expect(getNewCommentDepth(admin, 'root-uuid')).resolves.toBe(2)
  })

  it('throws when the RPC errors', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'rpc failed' },
    }))
    const admin = makeAdmin(rpc)
    await expect(getNewCommentDepth(admin, 'parent-uuid')).rejects.toThrow(
      /rpc failed/,
    )
  })

  it('throws parent_not_found when the parent UUID does not exist', async () => {
    // RPC returns NULL (via NULLIF on count=0) when p_parent matches no row.
    // Without the explicit guard, getNewCommentDepth would silently treat a
    // bogus UUID as a root comment (NULL + 1 → NaN or 1).
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    const admin = makeAdmin(rpc)
    await expect(getNewCommentDepth(admin, 'bogus-uuid')).rejects.toThrow(
      /parent_not_found/,
    )
  })
})
