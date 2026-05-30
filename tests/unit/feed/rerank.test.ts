import { describe, it, expect } from 'vitest'
import { rerankWithAffinity } from '@/lib/feed/rerank'
import type { RerankRow } from '@/lib/feed/rerank'

// Pin "now" so tests don't depend on wall-clock time.
const NOW = new Date('2026-05-30T12:00:00.000Z')

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString()
}

function makeRow(overrides: Partial<RerankRow>): RerankRow {
  return {
    id: 'row-base',
    author_id: 'author-1',
    type: 'post',
    slug: 'slug',
    title: 'title',
    summary: 'summary',
    cover_image_url: null,
    published_at: hoursAgo(1),
    like_count: 0,
    bookmark_count: 0,
    comment_count: 0,
    tag_slugs: [],
    ...overrides,
  }
}

describe('rerankWithAffinity', () => {
  it('returns an empty array when given no rows', () => {
    const out = rerankWithAffinity([], new Set(['memory']), { now: NOW })
    expect(out).toEqual([])
  })

  it('boosts a post whose tags overlap the viewer affinity above an identical one without overlap', () => {
    const withMatch = makeRow({
      id: 'with-match',
      tag_slugs: ['memory', 'evals'],
      like_count: 10,
      bookmark_count: 1,
      published_at: hoursAgo(3),
    })
    const withoutMatch = makeRow({
      id: 'without-match',
      tag_slugs: ['orchestration'],
      like_count: 10,
      bookmark_count: 1,
      published_at: hoursAgo(3),
    })

    const ranked = rerankWithAffinity([withoutMatch, withMatch], new Set(['memory']), {
      now: NOW,
    })

    expect(ranked.map((r) => r.id)).toEqual(['with-match', 'without-match'])
  })

  it('a fresh post with modest engagement outranks an old post with many likes', () => {
    const fresh = makeRow({
      id: 'fresh',
      tag_slugs: [],
      like_count: 10,
      bookmark_count: 0,
      published_at: hoursAgo(1),
    })
    const ancient = makeRow({
      id: 'ancient',
      tag_slugs: [],
      like_count: 100,
      bookmark_count: 0,
      // 14 days old
      published_at: hoursAgo(24 * 14),
    })

    const ranked = rerankWithAffinity([ancient, fresh], new Set(), { now: NOW })
    expect(ranked[0].id).toBe('fresh')
  })

  it('breaks ties on id desc when two rows have equal heat scores', () => {
    // Two rows with identical engagement, age, and (lack of) overlap →
    // computeHeatScore returns the same value. The tiebreaker is id desc.
    const a = makeRow({
      id: 'aaa',
      tag_slugs: [],
      like_count: 5,
      bookmark_count: 0,
      published_at: hoursAgo(2),
    })
    const b = makeRow({
      id: 'bbb',
      tag_slugs: [],
      like_count: 5,
      bookmark_count: 0,
      published_at: hoursAgo(2),
    })

    const ranked = rerankWithAffinity([a, b], new Set(), { now: NOW })
    expect(ranked.map((r) => r.id)).toEqual(['bbb', 'aaa'])
  })

  it('respects the `limit` option (default 30)', () => {
    const rows: RerankRow[] = Array.from({ length: 40 }, (_, i) =>
      makeRow({
        id: `id-${String(i).padStart(2, '0')}`,
        like_count: 40 - i,
        published_at: hoursAgo(1),
      }),
    )
    const defaulted = rerankWithAffinity(rows, new Set(), { now: NOW })
    expect(defaulted.length).toBe(30)

    const limited = rerankWithAffinity(rows, new Set(), { now: NOW, limit: 5 })
    expect(limited.length).toBe(5)
  })

  it('does not mutate the input rows', () => {
    const rows = [
      makeRow({ id: 'one', tag_slugs: ['memory'], like_count: 1 }),
      makeRow({ id: 'two', tag_slugs: [], like_count: 1 }),
    ]
    const snapshot = JSON.stringify(rows)
    rerankWithAffinity(rows, new Set(['memory']), { now: NOW })
    expect(JSON.stringify(rows)).toBe(snapshot)
  })

  it('treats an empty affinity set as zero overlap for every row', () => {
    // With no affinity, ranking should be driven purely by engagement /
    // recency. Higher like_count wins at the same age.
    const high = makeRow({
      id: 'high',
      tag_slugs: ['memory'],
      like_count: 50,
      published_at: hoursAgo(2),
    })
    const low = makeRow({
      id: 'low',
      tag_slugs: ['memory'],
      like_count: 1,
      published_at: hoursAgo(2),
    })
    const ranked = rerankWithAffinity([low, high], new Set(), { now: NOW })
    expect(ranked.map((r) => r.id)).toEqual(['high', 'low'])
  })
})
