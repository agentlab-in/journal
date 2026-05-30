'use client'

import { useCallback, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'

// Shared with the pre-hydration script in app/layout.tsx — kept literal in
// both spots so this file has no runtime dependency on the layout import
// graph (which would make it harder to test in isolation).
const THEME_STORAGE_KEY = 'theme'

function getThemeSnapshot(): Theme {
  const current = document.documentElement.getAttribute('data-theme') as Theme | null
  if (current === 'light' || current === 'dark') return current
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// SSR: return null so server output is stable (no window access).
function getServerSnapshot(): null {
  return null
}

// Subscribe to data-theme mutations on <html> so the component stays in sync
// if something else (e.g. an inline script) changes the attribute.
function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => observer.disconnect()
}

export default function ThemeToggle() {
  // useSyncExternalStore handles the SSR/client split without calling setState
  // inside an effect: server gets null (stable), client reads the real theme.
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerSnapshot)

  const toggle = useCallback(() => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    // Persist so the next visit / next page reload picks up the choice
    // and the pre-hydration script in app/layout.tsx skips the system
    // fallback. Wrapped in try/catch because Safari private mode and
    // some embedded webviews throw on localStorage access.
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Ignore — toggling still works in-session via the data-theme attr.
    }
  }, [theme])

  // Render a stable placeholder during SSR and before hydration to avoid
  // layout shift. Width matches the rendered button (monospace text-xs "light"
  // = ~36px content + 16px px-2 + 2px border; 52px covers the longest label).
  if (theme === null) {
    return <div className="w-[52px]" aria-hidden="true" />
  }

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      data-testid="theme-toggle"
      className="rounded border border-border px-2 py-1 text-xs text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
    >
      {theme === 'light' ? 'dark' : 'light'}
    </button>
  )
}
