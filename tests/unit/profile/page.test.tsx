import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProfileUser, ProfilePost, PinnedProfilePost } from '@/lib/profile/lookup'

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that trigger them
// ---------------------------------------------------------------------------

vi.mock('@/lib/profile/lookup', () => ({
  getCachedProfile: vi.fn(),
  getPinnedPosts: vi.fn(),
  getAuthoredPosts: vi.fn(),
  lookupProfileByUsername: vi.fn(),
}))

vi.mock('@/lib/profile/bio', () => ({
  renderBioToHtml: vi.fn(async (s: string) => `<p>${s}</p>`),
  bioToPlainText: vi.fn((s: string) => s),
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({ from: vi.fn() })),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`)
  }),
}))

vi.mock('@/components/profile/ProfileHeader', () => ({
  ProfileHeader: ({ isOwner }: { isOwner: boolean }) =>
    React.createElement('div', {
      'data-testid': 'profile-header',
      'data-is-owner': String(isOwner),
    }),
}))
vi.mock('@/components/profile/PinnedPosts', () => ({
  PinnedPosts: () => React.createElement('div', { 'data-testid': 'pinned-posts' }),
}))
vi.mock('@/components/profile/PostList', () => ({
  PostList: () => React.createElement('div', { 'data-testid': 'post-list' }),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import {
  getCachedProfile,
  getPinnedPosts,
  getAuthoredPosts,
} from '@/lib/profile/lookup'
import { getSession } from '@/lib/auth'
import { notFound, permanentRedirect } from 'next/navigation'
import { ProfileHeader } from '@/components/profile/ProfileHeader'
import { PinnedPosts } from '@/components/profile/PinnedPosts'
import { PostList } from '@/components/profile/PostList'
import ProfilePage from '@/app/[username]/page'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_PROFILE: ProfileUser = {
  id: 'user-1',
  username: 'alice',
  display_name: 'Alice',
  bio: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
}

// Walk the rendered tree looking for the first React element whose `type`
// matches `target` (a component function/class reference). Useful for
// asserting that a given mocked child component was rendered with the
// expected props in a server-component tree.
function findByComponentType(
  tree: React.ReactNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: (...args: any[]) => any,
): React.ReactElement | null {
  if (tree == null || tree === false || tree === true) return null
  if (Array.isArray(tree)) {
    for (const node of tree) {
      const found = findByComponentType(node, target)
      if (found) return found
    }
    return null
  }
  if (!React.isValidElement(tree)) return null
  if (tree.type === target) return tree
  const props = tree.props as Record<string, unknown>
  const children = props.children as React.ReactNode
  return findByComponentType(children, target)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.mocked(getCachedProfile).mockReset()
    vi.mocked(getPinnedPosts).mockReset()
    vi.mocked(getAuthoredPosts).mockReset()
    vi.mocked(getSession).mockReset()
    vi.mocked(notFound).mockClear()
    vi.mocked(permanentRedirect).mockClear()

    vi.mocked(getPinnedPosts).mockResolvedValue([] as PinnedProfilePost[])
    vi.mocked(getAuthoredPosts).mockResolvedValue([] as ProfilePost[])
  })

  it('permanentRedirects mixed-case usernames to lowercase', async () => {
    await expect(
      ProfilePage({ params: Promise.resolve({ username: 'Alice' }) }),
    ).rejects.toThrow('NEXT_PERMANENT_REDIRECT:/alice')
    expect(permanentRedirect).toHaveBeenCalledWith('/alice')
    expect(getCachedProfile).not.toHaveBeenCalled()
  })

  it('calls notFound when no profile matches', async () => {
    vi.mocked(getCachedProfile).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(
      ProfilePage({ params: Promise.resolve({ username: 'ghost' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('passes isOwner=false to ProfileHeader when not signed in', async () => {
    vi.mocked(getCachedProfile).mockResolvedValue(BASE_PROFILE)
    vi.mocked(getSession).mockResolvedValue(null)

    const tree = await ProfilePage({
      params: Promise.resolve({ username: 'alice' }),
    })
    const header = findByComponentType(tree, ProfileHeader)
    expect(header).not.toBeNull()
    expect((header!.props as { isOwner: boolean }).isOwner).toBe(false)
  })

  it('passes isOwner=false when signed in as someone else', async () => {
    vi.mocked(getCachedProfile).mockResolvedValue(BASE_PROFILE)
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'other-user', name: 'Bob', email: 'bob@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })

    const tree = await ProfilePage({
      params: Promise.resolve({ username: 'alice' }),
    })
    const header = findByComponentType(tree, ProfileHeader)
    expect((header!.props as { isOwner: boolean }).isOwner).toBe(false)
  })

  it('passes isOwner=true when signed in as the profile owner', async () => {
    vi.mocked(getCachedProfile).mockResolvedValue(BASE_PROFILE)
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })

    const tree = await ProfilePage({
      params: Promise.resolve({ username: 'alice' }),
    })
    const header = findByComponentType(tree, ProfileHeader)
    expect((header!.props as { isOwner: boolean }).isOwner).toBe(true)
  })

  it('renders PinnedPosts and PostList in the tree', async () => {
    vi.mocked(getCachedProfile).mockResolvedValue(BASE_PROFILE)
    vi.mocked(getSession).mockResolvedValue(null)

    const tree = await ProfilePage({
      params: Promise.resolve({ username: 'alice' }),
    })
    expect(findByComponentType(tree, PinnedPosts)).not.toBeNull()
    expect(findByComponentType(tree, PostList)).not.toBeNull()
  })
})
