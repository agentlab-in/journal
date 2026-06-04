/**
 * <ProfileSettingsForm /> — cancel link, post-save redirect, and "Saved."
 * status tests.
 *
 * Verifies:
 *  1. Cancel link renders with href="/<username>"
 *  2. Successful PATCH → "Saved." appears → router.push("/<username>") fires
 *  3. "Saved." is visible before navigation fires (600 ms delay)
 *  4. Empty-payload no-op shows "Saved." but does NOT redirect
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// ---- Next.js navigation mock — must be before component import ---------------
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { ProfileSettingsForm } from '@/components/profile/ProfileSettingsForm'

// Default props shared across tests
const DEFAULT_PROPS = {
  username: 'alice',
  displayName: 'Alice',
  bio: 'About me.',
  avatarUrl: null,
}

function submitForm() {
  const form = document.querySelector('form')
  if (!form) throw new Error('No form in DOM')
  fireEvent.submit(form)
}

// ---------------------------------------------------------------------------
// Cancel link (no timers needed — purely synchronous render)
// ---------------------------------------------------------------------------

describe('<ProfileSettingsForm> — Cancel link', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a Cancel link pointing to /<username>', () => {
    render(<ProfileSettingsForm {...DEFAULT_PROPS} />)
    const link = screen.getByRole('link', { name: /cancel/i })
    expect(link).toBeDefined()
    expect(link.getAttribute('href')).toBe('/alice')
  })

  it('Cancel link href updates when a different username is passed', () => {
    render(<ProfileSettingsForm {...DEFAULT_PROPS} username="bob" />)
    const link = screen.getByRole('link', { name: /cancel/i })
    expect(link.getAttribute('href')).toBe('/bob')
  })
})

// ---------------------------------------------------------------------------
// Successful PATCH → "Saved." → redirect after 600 ms
// ---------------------------------------------------------------------------

describe('<ProfileSettingsForm> — successful save redirects', () => {
  beforeEach(() => {
    mockPush.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('calls PATCH /api/users/me and shows "Saved." on success, then redirects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    )

    render(<ProfileSettingsForm {...DEFAULT_PROPS} bio="Updated bio." />)

    // Change bio so payload is non-empty
    const textarea = screen.getByRole('textbox', { name: 'Bio' })
    fireEvent.change(textarea, { target: { value: 'New bio content.' } })

    submitForm()

    // "Saved." should appear after the fetch resolves
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved.'),
    )

    // fetch was called with PATCH
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/users/me',
      expect.objectContaining({ method: 'PATCH' }),
    )

    // router.push fires after ~600 ms — wait for it with real timers
    await waitFor(
      () => expect(mockPush).toHaveBeenCalledWith('/alice'),
      { timeout: 1500 },
    )
    expect(mockPush).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Empty-payload path — stays on page
// ---------------------------------------------------------------------------

describe('<ProfileSettingsForm> — empty-payload no-op', () => {
  beforeEach(() => {
    mockPush.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows "Saved." but does NOT redirect when nothing changed', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    // Render with exact same initial values — don't change anything
    render(<ProfileSettingsForm {...DEFAULT_PROPS} />)

    submitForm()

    // "Saved." should appear (no-op path sets saveOk immediately)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved.'),
    )

    // No API call
    expect(mockFetch).not.toHaveBeenCalled()

    // Wait a generous window — no redirect should fire
    await new Promise((r) => setTimeout(r, 800))
    expect(mockPush).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Save error — stays on page, no redirect
// ---------------------------------------------------------------------------

describe('<ProfileSettingsForm> — save error', () => {
  beforeEach(() => {
    mockPush.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows save error and does NOT redirect on non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'validation_error' }),
      }),
    )

    render(<ProfileSettingsForm {...DEFAULT_PROPS} bio="Updated bio." />)

    const textarea = screen.getByRole('textbox', { name: 'Bio' })
    fireEvent.change(textarea, { target: { value: 'Failing bio.' } })

    submitForm()

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('validation_error'),
    )

    // Wait well past 600 ms — no redirect should fire
    await new Promise((r) => setTimeout(r, 800))
    expect(mockPush).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Redirect timer cleanup — clears timer on unmount
// ---------------------------------------------------------------------------

describe('<ProfileSettingsForm> — redirect timer cleanup', () => {
  beforeEach(() => {
    mockPush.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('clears the redirect timer if the form unmounts before it fires', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    )

    const { unmount } = render(<ProfileSettingsForm {...DEFAULT_PROPS} bio="Updated bio." />)

    // Change bio so payload is non-empty
    const textarea = screen.getByRole('textbox', { name: 'Bio' })
    fireEvent.change(textarea, { target: { value: 'New bio content.' } })

    submitForm()

    // "Saved." should appear after the fetch resolves — advance timers to allow promises
    // We need to flush microtasks without advancing the 600ms redirect timer
    await vi.waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved.'),
      { timeout: 500 },
    )

    // Unmount before the 600 ms timer fires
    unmount()

    // Advance time past 600 ms
    act(() => {
      vi.advanceTimersByTime(700)
    })

    // router.push should NOT have been called
    expect(mockPush).not.toHaveBeenCalled()
  })
})
