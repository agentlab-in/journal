import { describe, it, expect } from 'vitest'
import { computeHeatScore } from '../../lib/heat'

// All tests pin `now` so they are deterministic against `published_at`.
const NOW = new Date('2026-05-30T12:00:00.000Z')

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString()
}

describe('computeHeatScore', () => {
  it('returns 0 when there is no engagement, regardless of age', () => {
    const fresh = computeHeatScore(
      {
        published_at: hoursAgo(0),
        like_count: 0,
        bookmark_count: 0,
        tag_affinity: 0,
      },
      NOW,
    )
    const old = computeHeatScore(
      {
        published_at: hoursAgo(24 * 30),
        like_count: 0,
        bookmark_count: 0,
        tag_affinity: 0,
      },
      NOW,
    )
    expect(fresh).toBe(0)
    expect(old).toBe(0)
  })

  it('decays meaningfully as a post ages with the same like count', () => {
    const fresh = computeHeatScore(
      {
        published_at: hoursAgo(1),
        like_count: 100,
        bookmark_count: 0,
        tag_affinity: 0,
      },
      NOW,
    )
    const ancient = computeHeatScore(
      {
        published_at: hoursAgo(24 * 30), // 30 days old
        like_count: 100,
        bookmark_count: 0,
        tag_affinity: 0,
      },
      NOW,
    )
    expect(ancient).toBeLessThan(fresh)
    // The decay should be significant — order-of-magnitude small at 30 days.
    expect(ancient).toBeLessThan(fresh / 10)
    expect(ancient).toBeGreaterThan(0)
  })

  it('returns a positive finite number for a fresh post with high likes', () => {
    const score = computeHeatScore(
      {
        published_at: hoursAgo(0.5),
        like_count: 50,
        bookmark_count: 5,
        tag_affinity: 0,
      },
      NOW,
    )
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBeGreaterThan(0)
  })

  it('weights bookmarks 2x likes in the numerator', () => {
    // 10 bookmarks (numerator 20) vs 10 likes (numerator 10), same age,
    // same denominator => bookmarks score = 2 * likes score.
    const published = hoursAgo(3)
    const withLikes = computeHeatScore(
      {
        published_at: published,
        like_count: 10,
        bookmark_count: 0,
        tag_affinity: 0,
      },
      NOW,
    )
    const withBookmarks = computeHeatScore(
      {
        published_at: published,
        like_count: 0,
        bookmark_count: 10,
        tag_affinity: 0,
      },
      NOW,
    )
    expect(withBookmarks).toBeCloseTo(2 * withLikes, 10)
  })

  it('adds the +5 tag_affinity boost when tag_affinity > 0', () => {
    const base = {
      published_at: hoursAgo(2),
      like_count: 3,
      bookmark_count: 1,
    }
    const without = computeHeatScore({ ...base, tag_affinity: 0 }, NOW)
    const withAffinity = computeHeatScore({ ...base, tag_affinity: 1 }, NOW)

    // Boost should fire and produce a strictly higher score.
    expect(withAffinity).toBeGreaterThan(without)

    // Verify the boost magnitude is exactly +5 in the numerator: the
    // denominator is shared, so (with - without) * denom should equal 5.
    const hours = 2
    const denom = Math.pow(hours + 2, 1.5)
    expect((withAffinity - without) * denom).toBeCloseTo(5, 10)
  })

  it('treats any tag_affinity > 0 as the same flat boost (not scaled)', () => {
    const base = {
      published_at: hoursAgo(2),
      like_count: 0,
      bookmark_count: 0,
    }
    const one = computeHeatScore({ ...base, tag_affinity: 1 }, NOW)
    const many = computeHeatScore({ ...base, tag_affinity: 99 }, NOW)
    expect(many).toBe(one)
  })

  it('clamps future-dated posts to the freshest bucket (0 hours)', () => {
    const engagement = {
      like_count: 10,
      bookmark_count: 2,
      tag_affinity: 0,
    }
    const fresh = computeHeatScore(
      { ...engagement, published_at: hoursAgo(0) },
      NOW,
    )
    // published_at is 2 days in the future relative to NOW.
    const future = computeHeatScore(
      { ...engagement, published_at: hoursAgo(-48) },
      NOW,
    )
    expect(Number.isFinite(future)).toBe(true)
    expect(future).toBe(fresh)
  })

  it('treats a malformed published_at as freshly published (no NaN/Infinity)', () => {
    const engagement = {
      like_count: 10,
      bookmark_count: 2,
      tag_affinity: 0,
    }
    const fresh = computeHeatScore(
      { ...engagement, published_at: hoursAgo(0) },
      NOW,
    )
    const malformed = computeHeatScore(
      { ...engagement, published_at: 'not-a-date' },
      NOW,
    )
    expect(Number.isFinite(malformed)).toBe(true)
    expect(malformed).toBe(fresh)
  })

  it('is pure — same inputs return the same output', () => {
    const input = {
      published_at: hoursAgo(7),
      like_count: 12,
      bookmark_count: 3,
      tag_affinity: 1,
    }
    const a = computeHeatScore(input, NOW)
    const b = computeHeatScore(input, NOW)
    const c = computeHeatScore({ ...input }, new Date(NOW.getTime()))
    expect(a).toBe(b)
    expect(a).toBe(c)
  })
})
