import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BookmarkedPost } from '@/lib/bookmarks/list'

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that trigger them
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({})),
}))
vi.mock('@/lib/bookmarks/list', () => ({
  listUserBookmarks: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

// Stub ProfilePostCard so we can recognise rendered cards in the tree.
vi.mock('@/components/profile/ProfilePostCard', () => ({
  ProfilePostCard: ({ username, post }: { username: string; post: { id: string; title: string } }) =>
    React.createElement(
      'div',
      { 'data-testid': 'profile-post-card', 'data-username': username, 'data-post-id': post.id },
      post.title,
    ),
}))

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import { getSession } from '@/lib/auth'
import { listUserBookmarks } from '@/lib/bookmarks/list'
import { redirect } from 'next/navigation'
import { ProfilePostCard } from '@/components/profile/ProfilePostCard'
import BookmarksPage from '@/app/bookmarks/page'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectText(node: React.ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (!React.isValidElement(node)) return ''
  const props = node.props as Record<string, unknown>
  return collectText(props.children as React.ReactNode)
}

function findAllByComponentType(
  node: React.ReactNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: (...args: any[]) => any,
): React.ReactElement[] {
  const out: React.ReactElement[] = []
  function walk(n: React.ReactNode) {
    if (n == null || n === false || n === true) return
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (!React.isValidElement(n)) return
    if (n.type === target) out.push(n)
    const props = n.props as Record<string, unknown>
    walk(props.children as React.ReactNode)
  }
  walk(node)
  return out
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_BOOKMARK: BookmarkedPost = {
  id: 'post-1',
  type: 'post',
  slug: 'first',
  title: 'First Post',
  summary: 'A summary',
  cover_image_url: null,
  published_at: '2026-02-01T00:00:00Z',
  view_count: 5,
  comment_count: 0,
  bookmarked_at: '2026-03-01T00:00:00Z',
  author: {
    id: 'author-1',
    username: 'alice',
    display_name: 'Alice',
    avatar_url: null,
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BookmarksPage', () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset()
    vi.mocked(listUserBookmarks).mockReset()
    vi.mocked(redirect).mockClear()
  })

  it('redirects anon users to /auth/signin?callbackUrl=/bookmarks', async () => {
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(BookmarksPage()).rejects.toThrow(
      'NEXT_REDIRECT:/auth/signin?callbackUrl=/bookmarks',
    )

    expect(redirect).toHaveBeenCalledWith('/auth/signin?callbackUrl=/bookmarks')
    expect(listUserBookmarks).not.toHaveBeenCalled()
  })

  it('renders empty-state copy when signed in but has no bookmarks', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })
    vi.mocked(listUserBookmarks).mockResolvedValue([])

    const tree = await BookmarksPage()
    const text = collectText(tree)

    expect(text).toContain('Your bookmarks')
    expect(text).toContain('Bookmark posts to revisit them here.')
    expect(findAllByComponentType(tree, ProfilePostCard)).toHaveLength(0)
  })

  it('renders one ProfilePostCard per bookmark, using the AUTHOR username', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })
    vi.mocked(listUserBookmarks).mockResolvedValue([BASE_BOOKMARK])

    const tree = await BookmarksPage()
    const cards = findAllByComponentType(tree, ProfilePostCard)

    expect(cards).toHaveLength(1)
    const props = cards[0].props as { username: string; post: { id: string } }
    // The card MUST receive the AUTHOR's username (not the viewer's), so the
    // post link routes to /<author>/<type>/<slug>.
    expect(props.username).toBe('alice')
    expect(props.post.id).toBe('post-1')
  })
})
