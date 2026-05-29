import { describe, it, expect } from 'vitest'
import { postUrl, isPostType, POST_TYPES } from '@/lib/posts/url'

describe('postUrl', () => {
  it('builds /<username>/<type>/<slug>', () => {
    expect(postUrl('harshit', 'post', 'agent-memory')).toBe(
      '/harshit/post/agent-memory',
    )
  })
  it('builds for each type', () => {
    expect(postUrl('h', 'playbook', 's')).toBe('/h/playbook/s')
    expect(postUrl('h', 'dive', 's')).toBe('/h/dive/s')
  })
})

describe('isPostType', () => {
  it('accepts the three allowed values', () => {
    for (const t of POST_TYPES) expect(isPostType(t)).toBe(true)
  })
  it('rejects others', () => {
    expect(isPostType('pattern')).toBe(false)
    expect(isPostType('')).toBe(false)
    expect(isPostType('POST')).toBe(false)
  })
})
