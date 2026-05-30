import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LookedUpPost } from '@/lib/posts/lookup'

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that trigger them
// ---------------------------------------------------------------------------

vi.mock('@/lib/posts/lookup', () => ({
  lookupPost: vi.fn(),
  getCachedPost: vi.fn(),
}))

const isAdminState = { value: false }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
  isAdmin: vi.fn((login: string) => {
    void login
    return isAdminState.value
  }),
  resolveIsAdmin: vi.fn(async () => isAdminState.value),
}))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

// Lightweight stubs for child components — we just need them to render
// something identifiable so we can inspect the tree.
vi.mock('@/components/posts/PostBodyStatic', () => ({
  PostBodyStatic: ({ html }: { html: string }) =>
    React.createElement('div', { 'data-testid': 'post-body-static', dangerouslySetInnerHTML: { __html: html } }),
}))
vi.mock('@/components/posts/MermaidHydratorClient', () => ({
  MermaidHydratorClient: ({ scopeId }: { scopeId: string }) =>
    React.createElement('div', { 'data-testid': 'mermaid-hydrator', 'data-scope-id': scopeId }),
}))
vi.mock('@/components/posts/StructuredSections', () => ({
  StructuredSections: () => React.createElement('div', { 'data-testid': 'structured-sections' }),
}))
vi.mock('@/components/posts/ViewBeacon', () => ({
  ViewBeacon: () => React.createElement('div', { 'data-testid': 'view-beacon' }),
}))
vi.mock('@/components/posts/Backlinks', () => ({
  Backlinks: () => React.createElement('div', { 'data-testid': 'backlinks' }),
}))
vi.mock('@/components/post/CommentsSection', () => ({
  CommentsSection: () =>
    React.createElement('div', { 'data-testid': 'comments-section' }),
}))
vi.mock('@/components/posts/AuthorActions', () => ({
  AuthorActions: ({ postId }: { postId: string }) =>
    React.createElement('div', { 'data-testid': 'author-actions', 'data-post-id': postId }),
}))
vi.mock('@/components/post/LikeButton', () => ({
  LikeButton: () => React.createElement('div', { 'data-testid': 'like-button' }),
}))
vi.mock('@/components/post/BookmarkButton', () => ({
  BookmarkButton: () => React.createElement('div', { 'data-testid': 'bookmark-button' }),
}))
vi.mock('@/lib/posts/engagement', () => ({
  getEngagementState: vi.fn(async () => ({ liked: false, bookmarked: false })),
}))
vi.mock('@/lib/profile/follow-state', () => ({
  getFollowState: vi.fn(async () => false),
}))
vi.mock('@/components/profile/FollowButton', () => ({
  FollowButton: () => React.createElement('div', { 'data-testid': 'follow-button' }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({})),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import { getCachedPost } from '@/lib/posts/lookup'
import { getSession, resolveIsAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { AuthorActions } from '@/components/posts/AuthorActions'
// Dynamic import of the page (avoids circular-mock issues at the top level)
import PostPage from '@/app/[username]/[type]/[slug]/page'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find elements by their component type (for server component stubs whose
 * data-testid is on the rendered output, not the React element itself). */
function findByComponentType(
  tree: React.ReactNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: (...args: any[]) => any,
): boolean {
  function walk(node: React.ReactNode): boolean {
    if (node == null || node === false || node === true) return false
    if (Array.isArray(node)) {
      return node.some(walk)
    }
    if (!React.isValidElement(node)) return false
    if (node.type === target) return true
    const props = node.props as Record<string, unknown>
    const children = props.children
    if (children == null) return false
    if (Array.isArray(children)) {
      return children.some(walk)
    }
    return walk(children as React.ReactNode)
  }
  return walk(tree)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_POST: LookedUpPost = {
  id: 'post-1',
  author_id: 'user-1',
  type: 'post',
  slug: 'my-post',
  title: 'My Post',
  summary: 'A summary',
  body_html: '<p>Hello</p>',
  cover_image_url: null,
  structured_sections: null,
  view_count: 10,
  comment_count: 0,
  like_count: 0,
  published_at: '2026-01-01T00:00:00Z',
  edited_at: null,
  author: {
    id: 'user-1',
    username: 'alice',
    display_name: 'Alice',
    avatar_url: null,
    bio: null,
  },
  tags: [],
}

const VALID_PARAMS = {
  username: 'alice',
  type: 'post',
  slug: 'my-post',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PostPage', () => {
  beforeEach(() => {
    vi.mocked(getCachedPost).mockReset()
    vi.mocked(getSession).mockReset()
    vi.mocked(resolveIsAdmin).mockReset()
    isAdminState.value = false
    // Default resolveIsAdmin to false unless overridden
    vi.mocked(resolveIsAdmin).mockResolvedValue(false)
  })

  it('calls notFound() when getCachedPost returns null (invalid type)', async () => {
    vi.mocked(getCachedPost).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(
      PostPage({ params: Promise.resolve({ username: 'alice', type: 'random', slug: 'my-post' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
  })

  it('calls notFound() when getCachedPost returns null (mixed-case username)', async () => {
    vi.mocked(getCachedPost).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(
      PostPage({ params: Promise.resolve({ username: 'Alice', type: 'post', slug: 'my-post' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
  })

  it('calls notFound() when getCachedPost returns null (soft-deleted post)', async () => {
    vi.mocked(getCachedPost).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(
      PostPage({ params: Promise.resolve(VALID_PARAMS) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
  })

  it('does NOT render AuthorActions when user is not signed in', async () => {
    vi.mocked(getCachedPost).mockResolvedValue(BASE_POST)
    vi.mocked(getSession).mockResolvedValue(null)

    const tree = await PostPage({ params: Promise.resolve(VALID_PARAMS) })

    expect(findByComponentType(tree, AuthorActions)).toBe(false)
  })

  it('does NOT render AuthorActions when signed-in user is not the author (and not admin)', async () => {
    vi.mocked(getCachedPost).mockResolvedValue(BASE_POST)
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'other-user-99', name: 'Bob', email: 'bob@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })
    vi.mocked(resolveIsAdmin).mockResolvedValue(false)

    const tree = await PostPage({ params: Promise.resolve(VALID_PARAMS) })

    expect(findByComponentType(tree, AuthorActions)).toBe(false)
  })

  it('renders AuthorActions when signed-in user is the author', async () => {
    vi.mocked(getCachedPost).mockResolvedValue(BASE_POST)
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })

    const tree = await PostPage({ params: Promise.resolve(VALID_PARAMS) })

    expect(findByComponentType(tree, AuthorActions)).toBe(true)
  })

  it('renders AuthorActions when signed-in non-author user is an admin', async () => {
    vi.mocked(getCachedPost).mockResolvedValue(BASE_POST)
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'admin-user-99', name: 'Admin', email: 'admin@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })
    // Non-author (id != 'user-1'), but is admin
    vi.mocked(resolveIsAdmin).mockResolvedValue(true)

    const tree = await PostPage({ params: Promise.resolve(VALID_PARAMS) })

    expect(findByComponentType(tree, AuthorActions)).toBe(true)
  })
})
