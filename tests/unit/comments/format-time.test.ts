import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '@/lib/comments/format-time'

const NOW = new Date('2026-05-30T12:00:00Z')

describe('formatRelativeTime', () => {
  it('returns "just now" for < 60s', () => {
    expect(formatRelativeTime('2026-05-30T11:59:30Z', NOW)).toBe('just now')
  })

  it('returns minutes for < 1h', () => {
    expect(formatRelativeTime('2026-05-30T11:55:00Z', NOW)).toBe('5m ago')
  })

  it('returns hours for < 1d', () => {
    expect(formatRelativeTime('2026-05-30T09:00:00Z', NOW)).toBe('3h ago')
  })

  it('returns days for < 30d', () => {
    expect(formatRelativeTime('2026-05-28T12:00:00Z', NOW)).toBe('2d ago')
  })

  it('falls back to an absolute date for >= 30d', () => {
    const r = formatRelativeTime('2026-04-01T12:00:00Z', NOW)
    expect(r).toMatch(/Apr 1, 2026/)
  })

  it('returns empty string for unparseable input', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('')
  })
})
