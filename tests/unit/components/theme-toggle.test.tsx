/**
 * <ThemeToggle /> — Phase 13 theme persistence tests.
 *
 * Verifies the two contract pieces the dark-mode audit added:
 *   1. Clicking the toggle writes the next theme to localStorage so the
 *      pre-hydration script in app/layout.tsx picks it up on reload.
 *   2. Clicking the toggle sets `data-theme` on <html> so the live page
 *      reflects the change without a refresh.
 *
 * jsdom does not implement matchMedia, so we stub it before the component
 * reads any media query. matchMedia is only consulted when data-theme is
 * absent, which is the first-load case we want to cover.
 */
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ThemeToggle from '@/components/layout/ThemeToggle'

function stubMatchMedia(prefersDark: boolean) {
  const matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  // ThemeToggle reads `window.matchMedia` directly inside the snapshot
  // function passed to useSyncExternalStore. Defining the property is
  // needed because jsdom doesn't ship a matchMedia implementation.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  })
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  window.localStorage.clear()
  stubMatchMedia(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
  window.localStorage.clear()
})

describe('<ThemeToggle>', () => {
  it('renders the inverse label when data-theme is light', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    render(<ThemeToggle />)
    const btn = screen.getByTestId('theme-toggle')
    expect(btn).toHaveTextContent('dark')
    expect(btn).toHaveAttribute('aria-label', 'Switch to dark theme')
  })

  it('toggling from light to dark writes data-theme="dark" on <html> and persists to localStorage', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    render(<ThemeToggle />)
    const btn = screen.getByTestId('theme-toggle')
    fireEvent.click(btn)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(window.localStorage.getItem('theme')).toBe('dark')
  })

  it('toggling from dark to light writes data-theme="light" and persists', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    render(<ThemeToggle />)
    const btn = screen.getByTestId('theme-toggle')
    fireEvent.click(btn)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(window.localStorage.getItem('theme')).toBe('light')
  })

  it('survives a localStorage write throwing (Safari private mode, embedded webviews)', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
    render(<ThemeToggle />)
    const btn = screen.getByTestId('theme-toggle')
    // Should not throw, and the in-session data-theme must still flip so
    // the user sees the toggle take effect even when persistence fails.
    expect(() => fireEvent.click(btn)).not.toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    setItem.mockRestore()
  })
})
