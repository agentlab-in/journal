'use client'

import { useEffect, useRef } from 'react'

export interface PostBodyProps {
  html: string
}

let mermaidIdCounter = 0

export function PostBody({ html }: PostBodyProps) {
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
      const mermaid = (await import('mermaid')).default
      const theme =
        document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
      mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })

      for (const codeEl of Array.from(codeEls)) {
        if (cancelled) break
        const preEl = codeEl.parentElement
        if (!preEl) continue
        const code = codeEl.textContent ?? ''
        const id = `mermaid-postbody-${++mermaidIdCounter}`
        try {
          const { svg } = await mermaid.render(id, code)
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
  }, [html])

  return (
    <div
      ref={wrapperRef}
      className="post-body prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
