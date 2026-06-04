import { describe, it, expect, beforeEach } from 'vitest'
import { isValidCoverImageUrl } from '@/lib/posts/cover-image'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
})

describe('isValidCoverImageUrl', () => {
  it('accepts a covers-bucket URL', () => {
    expect(
      isValidCoverImageUrl(
        'https://abc.supabase.co/storage/v1/object/public/covers/userid/uuid.webp',
      ),
    ).toBe(true)
  })
  it('rejects a different bucket', () => {
    expect(
      isValidCoverImageUrl(
        'https://abc.supabase.co/storage/v1/object/public/avatars/x.png',
      ),
    ).toBe(false)
  })
  it('rejects a different host', () => {
    expect(
      isValidCoverImageUrl(
        'https://evil.example/storage/v1/object/public/covers/x.webp',
      ),
    ).toBe(false)
  })
  it('rejects non-URLs', () => {
    expect(isValidCoverImageUrl('')).toBe(false)
    expect(isValidCoverImageUrl('not-a-url')).toBe(false)
  })
  it('rejects a path with /../ segments that would escape the covers bucket', () => {
    // WHATWG URL parsing collapses `..` at parse time so the resulting
    // pathname lands under `/authenticated/...`, not `/covers/...` —
    // the prefix check is what actually rejects this. The literal
    // string would otherwise pass the old `startsWith` test.
    expect(
      isValidCoverImageUrl(
        'https://abc.supabase.co/storage/v1/object/public/covers/../authenticated/key.png',
      ),
    ).toBe(false)
  })
})
