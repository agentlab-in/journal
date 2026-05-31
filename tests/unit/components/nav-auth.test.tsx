/**
 * <NavAuth /> — Write CTA visibility tests.
 *
 * The component branches on next-auth's useSession() status. We mock the
 * hook directly so each test can pin the session to loading / unauth /
 * authed without going through a real NextAuth provider.
 *
 * Coverage focus is the Write button: present + ordered before Bookmarks
 * when authed, absent for anon and loading states.
 */
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const mockUseSession = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
  signOut: vi.fn(),
}))

import NavAuth from '@/components/layout/NavAuth'

afterEach(() => {
  cleanup()
  mockUseSession.mockReset()
})

describe('<NavAuth>', () => {
  it('shows the Write link pointing at /write when authenticated', () => {
    mockUseSession.mockReturnValue({
      status: 'authenticated',
      data: { user: { name: 'Ada', username: 'ada' } },
    })

    render(<NavAuth />)

    const write = screen.getByRole('link', { name: /^write$/i })
    expect(write).toBeInTheDocument()
    expect(write.getAttribute('href')).toBe('/write')
  })

  it('renders Write before Bookmarks in the authed nav', () => {
    mockUseSession.mockReturnValue({
      status: 'authenticated',
      data: { user: { name: 'Ada', username: 'ada' } },
    })

    render(<NavAuth />)

    const write = screen.getByRole('link', { name: /^write$/i })
    const bookmarks = screen.getByRole('link', { name: /^bookmarks$/i })

    // DOM order: Write must appear before Bookmarks so it sits to the left.
    expect(
      write.compareDocumentPosition(bookmarks) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('does NOT show Write when unauthenticated — only the Sign in link', () => {
    mockUseSession.mockReturnValue({ status: 'unauthenticated', data: null })

    render(<NavAuth />)

    expect(screen.queryByRole('link', { name: /^write$/i })).toBeNull()
    expect(
      screen.getByRole('link', { name: /sign in/i }).getAttribute('href'),
    ).toBe('/auth/signin')
  })

  it('does NOT show Write while the session is loading', () => {
    mockUseSession.mockReturnValue({ status: 'loading', data: null })

    render(<NavAuth />)

    expect(screen.queryByRole('link', { name: /^write$/i })).toBeNull()
  })
})
