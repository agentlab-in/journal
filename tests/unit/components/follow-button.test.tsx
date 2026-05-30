/**
 * <FollowButton /> — follow toggle tests.
 *
 * Mirrors the LikeButton test pattern: stub `useRouter` so anon-click
 * routing is observable, stub global.fetch per-test so we can assert
 * method + reconciled state.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { FollowButton } from '@/components/profile/FollowButton'

beforeEach(() => {
  mockPush.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('<FollowButton>', () => {
  it('anon click routes to /auth/signin with the encoded callbackUrl and does NOT call fetch', () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    render(
      <FollowButton
        targetUserId="user-2"
        initialFollowing={false}
        isSignedIn={false}
        currentPath="/alice"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /follow/i }))

    expect(mockPush).toHaveBeenCalledWith('/auth/signin?callbackUrl=%2Falice')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('signed-in click on not-following → optimistic flip + POST, reconciles from server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ following: true, follower_count: 6 }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <FollowButton
        targetUserId="user-2"
        initialFollowing={false}
        isSignedIn
        currentPath="/alice"
      />,
    )

    const btn = screen.getByRole('button', { name: /^follow$/i })
    fireEvent.click(btn)

    // Optimistic: label flips to Unfollow and aria-pressed=true immediately
    expect(screen.getByRole('button', { name: /unfollow/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /unfollow/i })).toHaveTextContent(
      /following/i,
    )

    expect(mockFetch).toHaveBeenCalledWith('/api/follows/user-2', {
      method: 'POST',
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /unfollow/i }),
      ).not.toBeDisabled(),
    )
  })

  it('signed-in click on following → optimistic flip + DELETE, reconciles', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ following: false, follower_count: 4 }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <FollowButton
        targetUserId="user-2"
        initialFollowing={true}
        isSignedIn
        currentPath="/alice"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /unfollow/i }))

    // Optimistic: label flips back to Follow
    expect(screen.getByRole('button', { name: /^follow$/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(mockFetch).toHaveBeenCalledWith('/api/follows/user-2', {
      method: 'DELETE',
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^follow$/i }),
      ).not.toBeDisabled(),
    )
  })

  it('reverts optimistic state when fetch returns a non-2xx response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'follow_failed' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <FollowButton
        targetUserId="user-2"
        initialFollowing={false}
        isSignedIn
        currentPath="/alice"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^follow$/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^follow$/i }),
      ).toHaveAttribute('aria-pressed', 'false'),
    )
  })

  it('reverts when fetch throws (network error)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', mockFetch)

    render(
      <FollowButton
        targetUserId="user-2"
        initialFollowing={true}
        isSignedIn
        currentPath="/alice"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /unfollow/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /unfollow/i }),
      ).toHaveAttribute('aria-pressed', 'true'),
    )
  })
})
