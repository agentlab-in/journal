'use client'

import { useState } from 'react'

type Theme = 'light' | 'dark'

function readThemeFromDOM(): Theme {
  if (typeof window === 'undefined') return 'light'
  const current = document.documentElement.getAttribute('data-theme') as Theme | null
  if (current === 'light' || current === 'dark') return current
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function ThemeToggle() {
  // Lazy initializer so we only read the DOM once, on first render (client only).
  const [theme, setTheme] = useState<Theme>(readThemeFromDOM)

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    setTheme(next)
    // Note: localStorage persistence is deferred to Phase 13.
  }

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      data-testid="theme-toggle"
      className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--fg-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
    >
      {theme === 'light' ? 'dark' : 'light'}
    </button>
  )
}
