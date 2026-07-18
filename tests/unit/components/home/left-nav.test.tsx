/**
 * <LeftNav /> — section navigation tests.
 *
 * Coverage:
 *   1. Active route gets aria-current="page" (exact pathname match).
 *   2. Bookmarks renders only when session is authenticated.
 *   3. Profile renders only when session is authenticated + username is set.
 *   4. Profile href is `/${username}`.
 *   5. Bookmarks and Profile are hidden when session is null (unauthenticated).
 *
 * Mocking pattern follows tests/unit/components/nav-auth.test.tsx:
 *   - `next-auth/react` → mock useSession
 *   - `next/navigation` → mock usePathname
 */
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Mock next/navigation
const mockUsePathname = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

// Mock next-auth/react
const mockUseSession = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
  signOut: vi.fn(),
}))

import { LeftNav } from '@/components/home/LeftNav'

afterEach(() => {
  cleanup()
  mockUsePathname.mockReset()
  mockUseSession.mockReset()
})

describe('<LeftNav>', () => {
  describe('active route marking', () => {
    it('marks the Home link aria-current="page" when on /', () => {
      mockUsePathname.mockReturnValue('/')
      mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })

      render(<LeftNav />)

      const homeLink = screen.getByRole('link', { name: 'Home' })
      expect(homeLink).toHaveAttribute('aria-current', 'page')
    })

    it('does NOT mark Home as active when on /tags', () => {
      mockUsePathname.mockReturnValue('/tags')
      mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })

      render(<LeftNav />)

      const homeLink = screen.getByRole('link', { name: 'Home' })
      expect(homeLink).not.toHaveAttribute('aria-current', 'page')
    })
  })

  describe('unauthenticated state', () => {
    it('renders public items (Home, All tags)', () => {
      mockUsePathname.mockReturnValue('/')
      mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })

      render(<LeftNav />)

      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'All tags' })).toBeInTheDocument()
    })

    it('does NOT render Bookmarks when unauthenticated', () => {
      mockUsePathname.mockReturnValue('/')
      mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })

      render(<LeftNav />)

      expect(screen.queryByRole('link', { name: 'Bookmarks' })).toBeNull()
    })

    it('does NOT render Profile when unauthenticated', () => {
      mockUsePathname.mockReturnValue('/')
      mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })

      render(<LeftNav />)

      expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull()
    })
  })

  describe('authenticated state', () => {
    it('renders Bookmarks when session is present', () => {
      mockUsePathname.mockReturnValue('/')
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { id: '1', name: 'Ada', username: 'ada' } },
      })

      render(<LeftNav />)

      expect(screen.getByRole('link', { name: 'Bookmarks' })).toBeInTheDocument()
    })

    it('renders Profile when session has a username', () => {
      mockUsePathname.mockReturnValue('/')
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { id: '1', name: 'Ada', username: 'ada' } },
      })

      render(<LeftNav />)

      expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    })

    it('Profile href is /${username}', () => {
      mockUsePathname.mockReturnValue('/')
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { id: '1', name: 'Ada', username: 'ada' } },
      })

      render(<LeftNav />)

      const profileLink = screen.getByRole('link', { name: 'Profile' })
      expect(profileLink.getAttribute('href')).toBe('/ada')
    })

    it('marks Profile aria-current="page" when on the profile route', () => {
      mockUsePathname.mockReturnValue('/ada')
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { id: '1', name: 'Ada', username: 'ada' } },
      })

      render(<LeftNav />)

      const profileLink = screen.getByRole('link', { name: 'Profile' })
      expect(profileLink).toHaveAttribute('aria-current', 'page')
    })

    it('marks Bookmarks aria-current="page" when on /bookmarks', () => {
      mockUsePathname.mockReturnValue('/bookmarks')
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { id: '1', name: 'Ada', username: 'ada' } },
      })

      render(<LeftNav />)

      const bookmarksLink = screen.getByRole('link', { name: 'Bookmarks' })
      expect(bookmarksLink).toHaveAttribute('aria-current', 'page')
    })

    it('does NOT render Profile if session is present but username is absent', () => {
      mockUsePathname.mockReturnValue('/')
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { id: '1', name: 'Ada', username: null } },
      })

      render(<LeftNav />)

      // Bookmarks still renders (session is present)
      expect(screen.getByRole('link', { name: 'Bookmarks' })).toBeInTheDocument()
      // Profile does NOT render without username
      expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull()
    })
  })

  describe('item order', () => {
    it('renders items in locked order: Home, All tags, Bookmarks, Profile', () => {
      mockUsePathname.mockReturnValue('/')
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { id: '1', name: 'Ada', username: 'ada' } },
      })

      render(<LeftNav />)

      const links = screen.getAllByRole('link')
      const labels = links.map((l) => l.textContent)

      expect(labels).toEqual(['Home', 'All tags', 'Bookmarks', 'Profile'])
    })
  })
})
