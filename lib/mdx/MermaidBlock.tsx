'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { initMermaidOnce } from '@/lib/mdx/mermaid-init'

/**
 * Client-only Mermaid renderer. The component receives the fenced-code
 * `code` string (already class="language-mermaid" in HAST). On mount it
 * dynamically `import('mermaid')`, initialises it once per page with the
 * theme picked from `document.documentElement.dataset.theme`, then calls
 * `mermaid.render(id, code)` and injects the resulting SVG.
 *
 * Errors render a small monospace fallback so a malformed diagram never
 * blocks the surrounding article.
 */

export interface MermaidBlockProps {
  code: string
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const id = useId().replace(/[:]/g, '')
  const ref = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        const theme =
          document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
        await initMermaidOnce(theme)
        const { svg } = await mermaid.render(`mermaid-${id}`, code)
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid render error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, id])

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
        <code>{`Mermaid error: ${error}\n\n${code}`}</code>
      </pre>
    )
  }

  return <div ref={ref} className="my-6 flex justify-center" aria-label="diagram" />
}
