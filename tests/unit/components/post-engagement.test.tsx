/**
 * <LikeButton /> + <BookmarkButton /> — engagement primitive tests.
 *
 * Both components are pure client components that mutate local state and
 * hit `fetch`. We mock `next/navigation`'s `useRouter` so anon-click
 * routing is observable, and stub `global.fetch` per-test so we can
 * assert method + payload + reconcile the optimistic state.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { LikeButton } from '@/components/post/LikeButton'
import { BookmarkButton } from '@/components/post/BookmarkButton'

beforeEach(() => {
  mockPush.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// LikeButton
// ---------------------------------------------------------------------------

describe('<LikeButton>', () => {
  it('anon click routes to /auth/signin with the encoded callbackUrl and does NOT call fetch', () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    render(
      <LikeButton
        postId="post-1"
        initialLiked={false}
        initialCount={3}
        isSignedIn={false}
        currentPath="/alice/post/hello"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /like/i }))

    expect(mockPush).toHaveBeenCalledWith(
      '/auth/signin?callbackUrl=%2Falice%2Fpost%2Fhello',
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('signed-in click on unliked → optimistic flip + POST, then reconciles from server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ liked: true, like_count: 4 }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <LikeButton
        postId="post-1"
        initialLiked={false}
        initialCount={3}
        isSignedIn
        currentPath="/alice/post/hello"
      />,
    )

    const btn = screen.getByRole('button', { name: /like/i })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)

    // Optimistic state applied immediately. Label is stable ("Like post"
    // per ARIA toggle pattern); pressed-state conveys the toggle.
    expect(screen.getByRole('button', { name: /like/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('4')).toBeInTheDocument()

    expect(mockFetch).toHaveBeenCalledWith('/api/likes/post-1', { method: 'POST' })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /like/i }),
      ).not.toBeDisabled(),
    )
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('signed-in click on liked → optimistic flip + DELETE', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ liked: false, like_count: 9 }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <LikeButton
        postId="post-1"
        initialLiked={true}
        initialCount={10}
        isSignedIn
        currentPath="/alice/post/hello"
      />,
    )

    const btn = screen.getByRole('button', { name: /like/i })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn)

    // Optimistic flip — label stays "Like post", aria-pressed flips to false.
    expect(screen.getByRole('button', { name: /like/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith('/api/likes/post-1', {
      method: 'DELETE',
    })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /like/i })).not.toBeDisabled(),
    )
  })

  it('reverts optimistic state when fetch returns a non-2xx response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'like_failed' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <LikeButton
        postId="post-1"
        initialLiked={false}
        initialCount={3}
        isSignedIn
        currentPath="/alice/post/hello"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /like/i }))

    // Wait for the revert (post-fetch, post-finally)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /like/i }),
      ).toHaveAttribute('aria-pressed', 'false'),
    )
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('reverts when fetch throws (network error)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', mockFetch)

    render(
      <LikeButton
        postId="post-1"
        initialLiked={true}
        initialCount={5}
        isSignedIn
        currentPath="/alice/post/hello"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /like/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /like/i }),
      ).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// BookmarkButton
// ---------------------------------------------------------------------------

describe('<BookmarkButton>', () => {
  it('anon click routes to /auth/signin with the encoded callbackUrl and does NOT call fetch', () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    render(
      <BookmarkButton
        postId="post-1"
        initialBookmarked={false}
        isSignedIn={false}
        currentPath="/alice/post/hello"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^bookmark post$/i }))

    expect(mockPush).toHaveBeenCalledWith(
      '/auth/signin?callbackUrl=%2Falice%2Fpost%2Fhello',
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('signed-in click on unbookmarked → optimistic flip + POST', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bookmarked: true }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <BookmarkButton
        postId="post-1"
        initialBookmarked={false}
        isSignedIn
        currentPath="/alice/post/hello"
      />,
    )

    const btn = screen.getByRole('button', { name: /^bookmark post$/i })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)

    // Stable label per ARIA toggle pattern; aria-pressed conveys state.
    expect(
      screen.getByRole('button', { name: /^bookmark post$/i }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(mockFetch).toHaveBeenCalledWith('/api/bookmarks/post-1', {
      method: 'POST',
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^bookmark post$/i }),
      ).not.toBeDisabled(),
    )
  })

  it('signed-in click on bookmarked → DELETE and reverts on non-2xx', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'unbookmark_failed' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <BookmarkButton
        postId="post-1"
        initialBookmarked={true}
        isSignedIn
        currentPath="/alice/post/hello"
      />,
    )

    const btn = screen.getByRole('button', { name: /^bookmark post$/i })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn)
    expect(mockFetch).toHaveBeenCalledWith('/api/bookmarks/post-1', {
      method: 'DELETE',
    })

    // Server returned 5xx, so we revert back to pressed=true.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^bookmark post$/i }),
      ).toHaveAttribute('aria-pressed', 'true'),
    )
  })
})
