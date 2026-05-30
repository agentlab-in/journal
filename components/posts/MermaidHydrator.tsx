'use client'

import { useEffect } from 'react'
import { initMermaidOnce, getMermaid } from '@/lib/mdx/mermaid-init'

export interface MermaidHydratorProps {
  /**
   * Stable id used in the generated SVG ids; pass post.id so re-renders
   * on the same page (e.g. ISR revalidation) don't collide.
   */
  scopeId: string
}

/**
 * Hydrates Mermaid code blocks in the already-rendered `.post-body` markup.
 * Renders NO HTML — the static body comes from `<PostBodyStatic>`. This
 * component is mounted only on posts that contain at least one mermaid
 * block (see `lib/posts/has-mermaid.ts`) so the mermaid library + this
 * hydration code stay out of the bundle graph for everything else.
 *
 * Mounted via `dynamic(..., { ssr: false })` in `MermaidHydratorClient`
 * — all the work here is browser-only (DOM mutation + dynamic import of
 * the `mermaid` library), so skipping SSR removes this chunk from the
 * first-load manifest of pages that don't render it.
 */
export function MermaidHydrator({ scopeId }: MermaidHydratorProps) {
  useEffect(() => {
    let cancelled = false

    // Scope the search to the post body container. The post page renders
    // exactly one `.post-body`, so a document-level query is safe and
    // avoids needing a ref handed down from the static body.
    const codeEls = document.querySelectorAll<HTMLElement>(
      '.post-body pre > code.language-mermaid',
    )
    if (codeEls.length === 0) return

    void (async () => {
      const theme =
        document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
      await initMermaidOnce(theme)
      const mermaid = await getMermaid()

      for (let i = 0; i < codeEls.length; i++) {
        if (cancelled) break
        const codeEl = codeEls[i]
        const preEl = codeEl.parentElement
        if (!preEl) continue
        const code = codeEl.textContent ?? ''
        const blockId = `mermaid-${scopeId}-${i}`.replace(/[^a-zA-Z0-9_-]/g, '')
        try {
          const { svg } = await mermaid.render(blockId, code)
          if (cancelled) break
          const container = document.createElement('div')
          container.className = 'mermaid-svg my-6 flex justify-center'
          container.innerHTML = svg
          preEl.replaceWith(container)
        } catch (err) {
          if (cancelled) break
          const msg = err instanceof Error ? err.message : String(err)
          const errorPre = document.createElement('pre')
          errorPre.className = 'mermaid-error'
          errorPre.textContent = `Mermaid error: ${msg}\n\n${code}`
          preEl.replaceWith(errorPre)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [scopeId])

  return null
}
