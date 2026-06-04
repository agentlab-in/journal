'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { initMermaidOnce } from '@/lib/mdx/mermaid-init'

/**
 * Client-only Mermaid renderer. The component receives the fenced-code
 * `code` string (already class="language-mermaid" in HAST). On mount it
 * dynamically `import('mermaid')`, initialises it with the theme picked
 * from `document.documentElement.dataset.theme`, then calls
 * `mermaid.render(id, code)` and injects the resulting SVG.
 *
 * Phase 13 dark-mode audit: the component now subscribes to `data-theme`
 * mutations on <html> via useSyncExternalStore (mirroring ThemeToggle).
 * Toggling theme re-runs the render effect with the new mermaid theme so
 * the diagram visually matches the surrounding page without a refresh.
 *
 * Errors render a small monospace fallback so a malformed diagram never
 * blocks the surrounding article.
 */

export interface MermaidBlockProps {
  code: string
}

// Size thresholds for client-side DoS guard. mermaid parses + lays out
// every node on the main thread; a multi-megabyte diagram pinned the tab
// during fuzz testing. We refuse to render anything past 8000 chars and
// gate 2000-8000 behind an explicit click so a reader scrolling past a
// post doesn't pay the cost for diagrams they aren't looking at.
const MERMAID_HARD_LIMIT = 8000
const MERMAID_CLICK_TO_RENDER = 2000

// Read the current page theme as 'dark' | 'default' (mermaid's name for
// its light theme). Returning a string keyed off data-theme means the
// snapshot is referentially stable across reads and re-runs the effect
// only when the value actually flips.
function getMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
}

function getServerSnapshot(): 'default' {
  // SSR can't read the DOM. Default ('default' === mermaid's light) is
  // a safe pick — the effect only runs on the client and re-renders with
  // the real value once mounted.
  return 'default'
}

function subscribeToTheme(callback: () => void): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => observer.disconnect()
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const id = useId().replace(/[:]/g, '')
  const ref = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  // For diagrams in the 2000-8000 char range, wait for an explicit user
  // click before paying the parse + layout cost. Diagrams under the
  // threshold skip the gate; oversized diagrams skip directly to the
  // hard-limit fallback below.
  const oversized = code.length > MERMAID_HARD_LIMIT
  const heavy = !oversized && code.length > MERMAID_CLICK_TO_RENDER
  const [unlocked, setUnlocked] = useState<boolean>(!heavy)
  // Reset the gate when `code` shifts across the heavy/light boundary.
  // Without this, an editor-rerender that swaps a 3000-char body for a
  // 500-char body would leave a small diagram stuck behind the button,
  // and vice versa. The effect is a no-op while the category is stable.
  useEffect(() => {
    setUnlocked(!heavy)
  }, [heavy])
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getMermaidTheme,
    getServerSnapshot,
  )

  useEffect(() => {
    if (oversized || !unlocked) return
    let cancelled = false
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        await initMermaidOnce(theme)
        // Per-render caps on top of `securityLevel: 'strict'` set by
        // initMermaidOnce. mermaid treats initialize as a merge, so this
        // adds the size limits without clobbering the theme. (We don't
        // own `mermaid-init.ts`; the limits live here instead.)
        mermaid.initialize({ maxEdges: 500, maxTextSize: 50_000 })
        const { svg } = await mermaid.render(`mermaid-${id}`, code)
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg
          // Clear any prior error from a previous theme/code attempt now
          // that we successfully rendered. Doing this inside the async
          // block (not synchronously at effect entry) keeps the linter
          // happy and avoids a wasted re-render on every effect run.
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid render error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, id, theme, oversized, unlocked])

  if (oversized) {
    return (
      <pre className="overflow-x-auto rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        <code>{`Diagram too large to render — max ${MERMAID_HARD_LIMIT} chars (this one is ${code.length}).`}</code>
      </pre>
    )
  }

  if (!unlocked) {
    return (
      <button
        type="button"
        onClick={() => setUnlocked(true)}
        className="my-6 flex w-full items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        aria-label="Render diagram"
      >
        Click to render diagram ({code.length.toLocaleString()} chars)
      </button>
    )
  }

  if (error) {
    // Phase 13: dark variant on the error pill so the red callout doesn't
    // burn through the dark page background. red-50/200/900 stays for
    // light; red-950/700/100 darkens the chrome for dark.
    return (
      <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100">
        <code>{`Mermaid error: ${error}\n\n${code}`}</code>
      </pre>
    )
  }

  return <div ref={ref} className="my-6 flex justify-center" aria-label="diagram" />
}
