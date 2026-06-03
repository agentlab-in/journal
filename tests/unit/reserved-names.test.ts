import { describe, it, expect } from 'vitest'
import { RESERVED_USERNAMES, isReserved } from '@/lib/reserved-names'

describe('isReserved()', () => {
  it('returns true for "admin"', () => {
    expect(isReserved('admin')).toBe(true)
  })

  it('returns true for "ADMIN" (case-insensitive)', () => {
    expect(isReserved('ADMIN')).toBe(true)
  })

  it('returns true for "agentlab-in" (curator org slug)', () => {
    expect(isReserved('agentlab-in')).toBe(true)
  })

  it('returns true for "hsb-agent" (Harshit\'s bot account)', () => {
    expect(isReserved('hsb-agent')).toBe(true)
  })

  it('returns false for "harshitsinghbhandari"', () => {
    expect(isReserved('harshitsinghbhandari')).toBe(false)
  })

  it('returns true for all expected reserved names (lowercase check)', () => {
    const expected = [
      'api', 'admin', 'auth', '_next', 'static', 'public', 'assets',
      'about', 'contact', 'help', 'faq', 'support', 'privacy', 'terms', 'policy', 'legal', 'dmca',
      'grievance', 'content-policy', 'copyright',
      'login', 'logout', 'signin', 'signout', 'signup', 'register', 'sso', 'oauth',
      'new', 'write', 'edit', 'publish', 'draft', 'drafts', 'editor',
      'settings', 'profile', 'account', 'me', 'you', 'dashboard', 'billing',
      'home', 'feed', 'explore', 'discover', 'search', 'trending', 'popular', 'top', 'latest', 'for-you',
      'post', 'posts', 'dive', 'dives', 'playbook', 'playbooks', 'pattern', 'patterns',
      'tag', 'tags', 'topic', 'topics', 'category', 'categories',
      'user', 'users', 'author', 'authors', 'org', 'orgs', 'team', 'teams',
      'bookmark', 'bookmarks', 'like', 'likes', 'follow', 'followers', 'following',
      'comment', 'comments', 'reply', 'replies', 'notification', 'notifications', 'inbox',
      'report', 'reports', 'mod', 'moderation', 'flag',
      'rss', 'atom', 'feeds', 'sitemap', 'robots', 'manifest', '.well-known', 'favicon',
      'agentlab', 'agent', 'lab', 'root', 'system', 'anonymous', 'deleted',
      '404', '500', 'error', 'offline',
      'hsb-agent', 'agentlab-in',
    ]

    for (const name of expected) {
      expect(RESERVED_USERNAMES.has(name), `Expected "${name}" to be in RESERVED_USERNAMES`).toBe(true)
    }
  })

  it('RESERVED_USERNAMES is a ReadonlySet of lowercase strings', () => {
    // All entries should be lowercase
    for (const name of RESERVED_USERNAMES) {
      expect(name, `"${name}" should be lowercase`).toBe(name.toLowerCase())
    }
  })
})
