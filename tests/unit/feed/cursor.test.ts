import { describe, it, expect, vi } from 'vitest'
import { encodeCursor, decodeCursor, applyCursor } from '@/lib/feed/cursor'
import type { FeedCursor } from '@/lib/feed/cursor'

const SAMPLE: FeedCursor = {
  published_at: '2026-05-30T12:00:00.000Z',
  id: '11111111-2222-3333-4444-555555555555',
}

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a cursor through encode → decode', () => {
    const encoded = encodeCursor(SAMPLE)
    expect(typeof encoded).toBe('string')
    expect(encoded.length).toBeGreaterThan(0)
    // base64url uses only [A-Za-z0-9_-]; no padding `=`, `+`, or `/`.
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)

    const decoded = decodeCursor(encoded)
    expect(decoded).toEqual(SAMPLE)
  })

  it('returns null for malformed (non-base64) input', () => {
    // A control character can't appear inside a base64url string.
    expect(decodeCursor('not%%%valid%%%')).toBeNull()
    expect(decodeCursor('')).toBeNull()
  })

  it('returns null for valid base64 that is not the expected JSON shape', () => {
    const wrongShape = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url')
    expect(decodeCursor(wrongShape)).toBeNull()

    const missingId = Buffer.from(
      JSON.stringify({ published_at: '2026-05-30T12:00:00.000Z' }),
    ).toString('base64url')
    expect(decodeCursor(missingId)).toBeNull()

    const wrongTypes = Buffer.from(JSON.stringify({ published_at: 1, id: 2 })).toString(
      'base64url',
    )
    expect(decodeCursor(wrongTypes)).toBeNull()

    const notJson = Buffer.from('this is not json').toString('base64url')
    expect(decodeCursor(notJson)).toBeNull()
  })

  it('returns null when published_at is not a parseable date', () => {
    const bad = Buffer.from(
      JSON.stringify({ published_at: 'nope', id: SAMPLE.id }),
    ).toString('base64url')
    expect(decodeCursor(bad)).toBeNull()
  })

  it('returns null when fields contain characters outside the safe set', () => {
    // Try to smuggle a PostgREST filter break-out via the id.
    const poisonedId = Buffer.from(
      JSON.stringify({
        published_at: SAMPLE.published_at,
        id: "abc,or(deleted_at.is.null)",
      }),
    ).toString('base64url')
    expect(decodeCursor(poisonedId)).toBeNull()

    // Try the same on published_at.
    const poisonedDate = Buffer.from(
      JSON.stringify({
        published_at: "2026-05-30T12:00:00.000Z,or(x.eq.y)",
        id: SAMPLE.id,
      }),
    ).toString('base64url')
    expect(decodeCursor(poisonedDate)).toBeNull()
  })

  it('returns null for an empty id', () => {
    const empty = Buffer.from(
      JSON.stringify({ published_at: SAMPLE.published_at, id: '' }),
    ).toString('base64url')
    expect(decodeCursor(empty)).toBeNull()
  })
})

/**
 * Minimal chain stub: tracks `.or(...)` invocations and is fluent.
 *
 * Signature matches the structural generic `applyCursor` accepts
 * (`{ or: (...args: unknown[]) => T }`).
 */
function makeChainStub() {
  const orSpy = vi.fn()
  const chain: { or: (...args: unknown[]) => typeof chain } = {
    or: (...args: unknown[]) => {
      orSpy(...args)
      return chain
    },
  }
  return { chain, orSpy }
}

describe('applyCursor', () => {
  it('leaves the chain unchanged when cursor is null', () => {
    const { chain, orSpy } = makeChainStub()
    const out = applyCursor(chain, null)
    expect(out).toBe(chain)
    expect(orSpy).not.toHaveBeenCalled()
  })

  it('leaves the chain unchanged when cursor is undefined', () => {
    const { chain, orSpy } = makeChainStub()
    const out = applyCursor(chain, undefined)
    expect(out).toBe(chain)
    expect(orSpy).not.toHaveBeenCalled()
  })

  it('calls .or() exactly once with the lexicographic tuple filter', () => {
    const { chain, orSpy } = makeChainStub()
    const out = applyCursor(chain, SAMPLE)
    expect(out).toBe(chain)
    expect(orSpy).toHaveBeenCalledTimes(1)
    expect(orSpy).toHaveBeenCalledWith(
      `published_at.lt.${SAMPLE.published_at},and(published_at.eq.${SAMPLE.published_at},id.lt.${SAMPLE.id})`,
    )
  })

  it('throws if a cursor smuggled past decode contains unsafe chars', () => {
    const { chain } = makeChainStub()
    const poisoned: FeedCursor = {
      published_at: SAMPLE.published_at,
      id: 'abc,or(x.eq.y)',
    }
    expect(() => applyCursor(chain, poisoned)).toThrow(/unsafe/)
  })
})
