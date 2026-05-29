import { describe, it, expect } from 'vitest'
import { PostCreateBody, PostPatchBody } from '@/lib/posts/schema'

const baseBody = 'a'.repeat(60)

describe('PostCreateBody', () => {
  it('accepts a minimal post', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['rag'],
    })
    expect(parsed.success).toBe(true)
  })
  it('rejects unknown type', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'pattern',
      title: 't',
      summary: 's',
      body_md: baseBody,
      tags: ['rag'],
    })
    expect(parsed.success).toBe(false)
  })
  it('rejects > 5 tags', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    })
    expect(parsed.success).toBe(false)
  })
  it('rejects non-kebab tag', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['Rag Tag'],
    })
    expect(parsed.success).toBe(false)
  })
  it('rejects tag longer than 30 chars', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['a'.repeat(31)],
    })
    expect(parsed.success).toBe(false)
  })
  it('rejects body_md > 200000 chars', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: 'a'.repeat(200001),
      tags: ['rag'],
    })
    expect(parsed.success).toBe(false)
  })
  it('accepts optional cover_image_url', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['rag'],
      cover_image_url: 'https://example.com/x.webp',
    })
    expect(parsed.success).toBe(true)
  })
})

describe('PostPatchBody', () => {
  it('accepts shape sans type', () => {
    const parsed = PostPatchBody.safeParse({
      title: 'New title here',
      summary: 'New summary value.',
      body_md: baseBody,
      tags: ['rag'],
    })
    expect(parsed.success).toBe(true)
  })
  it('rejects when type is set', () => {
    const parsed = PostPatchBody.safeParse({
      type: 'post',
      title: 'New title here',
      summary: 'New summary value.',
      body_md: baseBody,
      tags: ['rag'],
    })
    expect(parsed.success).toBe(false)
  })
})
