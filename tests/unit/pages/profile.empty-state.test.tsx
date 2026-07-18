/**
 * Phase 13 — profile `/<username>` empty state.
 *
 * `PostList` is a client component that holds the per-tab filter state.
 * When the authored-posts query returns zero rows the "All" tab renders
 * "No posts yet." Filtering to a type with no posts shows the same copy.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// `PostList` wraps non-empty results in `<KeyboardFeedNav>`, which calls
// `useRouter()` (next/navigation). Stub the hook so the "switch tabs"
// case can render the initial "All" state before clicking through.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/alice',
  useSearchParams: () => new URLSearchParams(),
}))

// `ProfilePostCard` pulls in next/image and styling we don't need.
// A simple stub keeps the test focused on the empty-state copy.
vi.mock('@/components/profile/ProfilePostCard', () => ({
  ProfilePostCard: ({ post }: { post: { title: string } }) => (
    <div data-testid="profile-post-card">{post.title}</div>
  ),
}))

import { PostList } from '@/components/profile/PostList'
import type { ProfilePostCardData } from '@/components/profile/ProfilePostCard'

const POST_FIXTURE: ProfilePostCardData = {
  id: 'post-1',
  type: 'post',
  slug: 'first',
  title: 'First Post',
  summary: 'A summary',
  cover_image_url: null,
  published_at: '2026-02-01T00:00:00Z',
  tags: [],
}

describe('PostList empty state', () => {
  it('renders "No posts yet." when the author has zero posts', () => {
    render(
      <PostList
        username="alice"
        posts={[]}
        isOwner={false}
        initialPinnedIds={[]}
      />,
    )
    expect(screen.getByText('No posts yet.')).toBeInTheDocument()
  })

  it('renders "No posts yet." when the filtered tab has zero posts', () => {
    // A single `post` exists; switching to the "Playbooks" tab should show
    // the empty state because no playbooks exist for this author.
    render(
      <PostList
        username="alice"
        posts={[POST_FIXTURE]}
        isOwner={false}
        initialPinnedIds={[]}
      />,
    )

    // Sanity: the post is visible under the default "All" tab.
    expect(screen.getByText('First Post')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Playbooks' }))
    expect(screen.getByText('No posts yet.')).toBeInTheDocument()
  })
})
