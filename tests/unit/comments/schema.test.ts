import { describe, it, expect } from 'vitest'
import { CommentCreateBody, CommentPatchBody } from '@/lib/comments/schema'

const VALID_UUID = '11111111-1111-4111-8111-111111111111'
const PARENT_UUID = '22222222-2222-4222-8222-222222222222'

describe('CommentCreateBody', () => {
  it('accepts a minimal valid payload', () => {
    const parsed = CommentCreateBody.safeParse({
      post_id: VALID_UUID,
      body: 'a real comment',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a payload with parent_comment_id as a uuid', () => {
    const parsed = CommentCreateBody.safeParse({
      post_id: VALID_UUID,
      parent_comment_id: PARENT_UUID,
      body: 'reply',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts parent_comment_id as null', () => {
    const parsed = CommentCreateBody.safeParse({
      post_id: VALID_UUID,
      parent_comment_id: null,
      body: 'root',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts when parent_comment_id is omitted entirely', () => {
    const parsed = CommentCreateBody.safeParse({
      post_id: VALID_UUID,
      body: 'root',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects body shorter than 1 character', () => {
    const parsed = CommentCreateBody.safeParse({
      post_id: VALID_UUID,
      body: '',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects body longer than 5000 characters', () => {
    const parsed = CommentCreateBody.safeParse({
      post_id: VALID_UUID,
      body: 'a'.repeat(5001),
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects when post_id is not a uuid', () => {
    const parsed = CommentCreateBody.safeParse({
      post_id: 'not-a-uuid',
      body: 'hi',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects extra fields (.strict)', () => {
    const parsed = CommentCreateBody.safeParse({
      post_id: VALID_UUID,
      body: 'hi',
      malicious: 'value',
    })
    expect(parsed.success).toBe(false)
  })
})

describe('CommentPatchBody', () => {
  it('accepts a valid body', () => {
    const parsed = CommentPatchBody.safeParse({ body: 'edited' })
    expect(parsed.success).toBe(true)
  })

  it('rejects an empty body', () => {
    const parsed = CommentPatchBody.safeParse({ body: '' })
    expect(parsed.success).toBe(false)
  })

  it('rejects bodies longer than 5000 chars', () => {
    const parsed = CommentPatchBody.safeParse({ body: 'a'.repeat(5001) })
    expect(parsed.success).toBe(false)
  })

  it('rejects extra fields (.strict)', () => {
    const parsed = CommentPatchBody.safeParse({
      body: 'edited',
      post_id: VALID_UUID,
    })
    expect(parsed.success).toBe(false)
  })
})
