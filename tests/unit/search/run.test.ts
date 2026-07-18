import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runSearch, type SearchHit } from '@/lib/search/run'

interface FakeClient {
  rpc: ReturnType<typeof vi.fn>
}

function makeClient(result: {
  data?: SearchHit[] | null
  error?: { message: string } | null
}): FakeClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  }
}

// The Supabase RPC generic signature is wider than our test fake; cast at
// the boundary so the test stays readable.
function asDb(fake: FakeClient): Pick<SupabaseClient, 'rpc'> {
  return fake as unknown as Pick<SupabaseClient, 'rpc'>
}

const SAMPLE_HIT: SearchHit = {
  id: '00000000-0000-0000-0000-000000000001',
  author_id: '00000000-0000-0000-0000-0000000000aa',
  type: 'post',
  slug: 'hello',
  title: 'Hello',
  summary: 'summary',
  snippet: 'sni<mark>ppe</mark>t',
  published_at: '2026-05-29T00:00:00.000Z',
  rank: 0.42,
}

describe('runSearch', () => {
  it('calls search_posts RPC with the expected payload', async () => {
    const db = makeClient({ data: [SAMPLE_HIT] })
    const hits = await runSearch(asDb(db), {
      q: 'hi',
      type: 'post',
      tags: ['security'],
    })

    expect(db.rpc).toHaveBeenCalledTimes(1)
    expect(db.rpc).toHaveBeenCalledWith('search_posts', {
      p_q: 'hi',
      p_type: 'post',
      p_tag_slugs: ['security'],
      p_limit: 50,
    })
    expect(hits).toEqual([SAMPLE_HIT])
  })

  it('passes null for type and tag_slugs when omitted', async () => {
    const db = makeClient({ data: [] })
    await runSearch(asDb(db), { q: 'hi', type: null, tags: [] })

    expect(db.rpc).toHaveBeenCalledWith('search_posts', {
      p_q: 'hi',
      p_type: null,
      p_tag_slugs: null,
      p_limit: 50,
    })
  })

  it('respects an explicit limit override', async () => {
    const db = makeClient({ data: [] })
    await runSearch(asDb(db), { q: 'hi', type: null, tags: [] }, { limit: 5 })

    expect(db.rpc).toHaveBeenCalledWith(
      'search_posts',
      expect.objectContaining({ p_limit: 5 }),
    )
  })

  it('returns [] and logs on RPC error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = makeClient({ error: { message: 'boom' } })
    const hits = await runSearch(asDb(db), { q: 'hi', type: null, tags: [] })
    expect(hits).toEqual([])
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('returns [] when RPC returns non-array data', async () => {
    const db = makeClient({ data: null })
    const hits = await runSearch(asDb(db), { q: 'hi', type: null, tags: [] })
    expect(hits).toEqual([])
  })
})
