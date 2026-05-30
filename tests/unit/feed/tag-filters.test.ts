import { describe, it, expect } from 'vitest'
import {
  resolveTypeFilter,
  resolveTimeFilter,
  timeCutoff,
} from '@/lib/feed/tag-filters'

describe('resolveTypeFilter', () => {
  it('defaults to "all" for missing input', () => {
    expect(resolveTypeFilter(undefined)).toBe('all')
  })

  it('defaults to "all" for invalid input', () => {
    expect(resolveTypeFilter('')).toBe('all')
    expect(resolveTypeFilter('garbage')).toBe('all')
    expect(resolveTypeFilter('POST')).toBe('all') // case-sensitive
    expect(resolveTypeFilter(' post ')).toBe('all')
  })

  it('accepts the four valid values verbatim', () => {
    expect(resolveTypeFilter('all')).toBe('all')
    expect(resolveTypeFilter('post')).toBe('post')
    expect(resolveTypeFilter('playbook')).toBe('playbook')
    expect(resolveTypeFilter('dive')).toBe('dive')
  })
})

describe('resolveTimeFilter', () => {
  it('defaults to "all" for missing input', () => {
    expect(resolveTimeFilter(undefined)).toBe('all')
  })

  it('defaults to "all" for invalid input', () => {
    expect(resolveTimeFilter('')).toBe('all')
    expect(resolveTimeFilter('1d')).toBe('all')
    expect(resolveTimeFilter('30D')).toBe('all') // case-sensitive
    expect(resolveTimeFilter('forever')).toBe('all')
  })

  it('accepts the three valid values verbatim', () => {
    expect(resolveTimeFilter('all')).toBe('all')
    expect(resolveTimeFilter('7d')).toBe('7d')
    expect(resolveTimeFilter('30d')).toBe('30d')
  })
})

describe('timeCutoff', () => {
  const NOW = new Date('2026-05-30T12:00:00.000Z')

  it('returns now - 7 days for "7d"', () => {
    // 2026-05-30T12:00Z minus 7d = 2026-05-23T12:00Z
    expect(timeCutoff('7d', NOW)).toBe('2026-05-23T12:00:00.000Z')
  })

  it('returns now - 30 days for "30d"', () => {
    // 2026-05-30T12:00Z minus 30d = 2026-04-30T12:00Z
    expect(timeCutoff('30d', NOW)).toBe('2026-04-30T12:00:00.000Z')
  })

  it('returns a parseable ISO timestamp', () => {
    const out = timeCutoff('7d', NOW)
    expect(Number.isNaN(new Date(out).getTime())).toBe(false)
  })

  it('defaults `now` to the current Date when omitted', () => {
    const before = Date.now()
    const out = timeCutoff('7d')
    const after = Date.now()
    const outMs = new Date(out).getTime()
    // 7 days in ms = 604_800_000.
    expect(outMs).toBeGreaterThanOrEqual(before - 604_800_000)
    expect(outMs).toBeLessThanOrEqual(after - 604_800_000)
  })
})
