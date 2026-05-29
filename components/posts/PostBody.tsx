'use client'

import { useEffect, useId, useRef } from 'react'
import { initMermaidOnce, getMermaid } from '@/lib/mdx/mermaid-init'

export interface PostBodyProps {
  html: string
}

export function PostBody({ html }: PostBodyProps) {
  const id = useId()
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const codeEls = wrapper.querySelectorAll<HTMLElement>(
      'pre > code.language-mermaid',
    )
    if (codeEls.length === 0) return

    void (async () => {
      const theme =
        document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
      await initMermaidOnce(theme)
      const mermaid = await getMermaid()

      for (let i = 0; i < Array.from(codeEls).length; i++) {
        if (cancelled) break
        const codeEl = Array.from(codeEls)[i]
        const preEl = codeEl.parentElement
        if (!preEl) continue
        const code = codeEl.textContent ?? ''
        const blockId = `mermaid-${id}-${i}`.replace(/[:]/g, '')
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
  }, [html, id])

  return (
    <div
      ref={wrapperRef}
      className="post-body prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
