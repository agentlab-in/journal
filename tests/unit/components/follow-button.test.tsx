/**
 * <FollowButton /> — follow toggle tests.
 *
 * Mirrors the LikeButton test pattern: stub `useRouter` so anon-click
 * routing is observable, stub global.fetch per-test so we can assert
 * method + reconciled state.
 *
 * Phase 13 a11y note: the button label is stable ("Follow @<username>")
 * per the ARIA Authoring Practices toggle pattern. Toggle state lives in
 * `aria-pressed`, not in the accessible name, so screen readers don't
 * announce conflicting verbs ("Unfollow, pressed"). Assertions below
 * check aria-pressed, not the label, for state changes.
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
        username="alice"
        initialFollowing={false}
        isSignedIn={false}
        currentPath="/alice"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /follow @alice/i }))

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
        username="alice"
        initialFollowing={false}
        isSignedIn
        currentPath="/alice"
      />,
    )

    const btn = screen.getByRole('button', { name: /follow @alice/i })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)

    // Optimistic: aria-pressed flips to true immediately; the visible
    // text switches from "Follow" to "Following" (still the same label).
    expect(screen.getByRole('button', { name: /follow @alice/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /follow @alice/i })).toHaveTextContent(
      /following/i,
    )

    expect(mockFetch).toHaveBeenCalledWith('/api/follows/user-2', {
      method: 'POST',
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /follow @alice/i }),
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
        username="alice"
        initialFollowing={true}
        isSignedIn
        currentPath="/alice"
      />,
    )

    const btn = screen.getByRole('button', { name: /follow @alice/i })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn)

    // Optimistic: aria-pressed flips to false.
    expect(screen.getByRole('button', { name: /follow @alice/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(mockFetch).toHaveBeenCalledWith('/api/follows/user-2', {
      method: 'DELETE',
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /follow @alice/i }),
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
        username="alice"
        initialFollowing={false}
        isSignedIn
        currentPath="/alice"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /follow @alice/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /follow @alice/i }),
      ).toHaveAttribute('aria-pressed', 'false'),
    )
  })

  it('reverts when fetch throws (network error)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', mockFetch)

    render(
      <FollowButton
        targetUserId="user-2"
        username="alice"
        initialFollowing={true}
        isSignedIn
        currentPath="/alice"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /follow @alice/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /follow @alice/i }),
      ).toHaveAttribute('aria-pressed', 'true'),
    )
  })
})

// ---------------------------------------------------------------------------
// Shake-on-revert visual treatment (Phase 13 polish)
// ---------------------------------------------------------------------------

describe('<FollowButton> shake-on-revert', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('failed click adds .shake-on-revert and removes it after ~400ms', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'follow_failed' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <FollowButton
        targetUserId="user-2"
        username="alice"
        initialFollowing={false}
        isSignedIn
        currentPath="/alice"
      />,
    )

    const btn = screen.getByRole('button', { name: /follow @alice/i })
    expect(btn).not.toHaveClass('shake-on-revert')

    fireEvent.click(btn)

    await vi.waitFor(
      () => expect(btn).toHaveClass('shake-on-revert'),
      { timeout: 1000 },
    )

    vi.advanceTimersByTime(401)
    expect(btn).not.toHaveClass('shake-on-revert')
  })
})
