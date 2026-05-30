'use client'

/**
 * <NavSearch /> — top-nav search affordance.
 *
 * Renders a GET form pointing at /search?q=... so submission is a plain
 * navigation (no JS required for the happy path). The client portion only
 * exists to wire up the global '/' shortcut.
 *
 * Keyboard shortcut: '/' focuses the input, UNLESS the user is already
 * typing in another text field. Modifier keys (cmd/ctrl/alt) suppress
 * the shortcut so browser/OS chords (e.g. "Find in page") aren't hijacked.
 *
 * Mobile collapse: pure CSS via `:focus-within`. The input is narrow
 * (2.5rem) at <= 640px and expands to a sensible width once focused.
 */

import { useEffect, useRef } from 'react'

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export default function NavSearch() {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '/') return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const active = document.activeElement as HTMLElement | null
      if (active) {
        if (TEXT_INPUT_TAGS.has(active.tagName)) return
        if (active.isContentEditable) return
      }

      e.preventDefault()
      inputRef.current?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <form action="/search" method="get" role="search" className="nav-search">
      <label className="sr-only" htmlFor="nav-search-input">
        Search posts
      </label>
      <input
        id="nav-search-input"
        ref={inputRef}
        type="search"
        name="q"
        placeholder="Search posts..."
        aria-label="Search posts"
        autoComplete="off"
        className="nav-search__input"
      />
      {/* Hidden submit so Enter inside the input submits the form. */}
      <button type="submit" className="sr-only">
        Search
      </button>
    </form>
  )
}
