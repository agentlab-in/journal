'use client'

/**
 * PreviewPane — live MDX preview that mirrors the editor state.
 *
 * Why a server route instead of a Web Worker?
 *   `next-mdx-remote/serialize` is Node-only (depends on `node:vm` and
 *   other server-side primitives), so it cannot run in a browser Web
 *   Worker. We POST the markdown to /api/mdx/preview every 300ms instead.
 *   That keeps the compile off the main thread (it runs on the server)
 *   while leaving the editor responsive for typing.
 *
 * Behaviour:
 *   - Debounce `body_md` changes by 300ms before firing a request.
 *   - Abort any in-flight request when a newer one starts (last-write-
 *     wins; prevents stale results from clobbering the latest preview).
 *   - On success → swap to the new serialized payload.
 *   - On compile error (HTTP 422 with { error: { message } }) → render
 *     an inline error banner so the author sees the diagnostic.
 *   - On network/other errors → render a generic banner; keep the last
 *     good preview visible underneath so the page doesn't go blank.
 */
import { useEffect, useRef, useState } from 'react'
import { MDXRemote, type MDXRemoteSerializeResult } from 'next-mdx-remote'
import { mdxComponents } from '@/lib/mdx/components'

export interface PreviewPaneProps {
  body_md: string
  className?: string
}

interface PreviewState {
  serialized: MDXRemoteSerializeResult | null
  error: string | null
  loading: boolean
}

const DEBOUNCE_MS = 300

export function PreviewPane({ body_md, className }: PreviewPaneProps) {
  const [state, setState] = useState<PreviewState>({
    serialized: null,
    error: null,
    loading: false,
  })

  // Track the latest in-flight AbortController so we can cancel it when
  // the user types again before the previous request finishes.
  const inFlight = useRef<AbortController | null>(null)
  // Track the latest issued request ordinal so an out-of-order resolve
  // (e.g. an aborted fetch that still ran a microtask) never overwrites
  // a fresher result.
  const seqRef = useRef(0)

  useEffect(() => {
    const handle = window.setTimeout(() => {
      // Cancel the previous in-flight request; we don't need its answer.
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller

      const seq = ++seqRef.current
      setState((s) => ({ ...s, loading: true }))

      fetch('/api/mdx/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_md }),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (seq !== seqRef.current) return
          if (res.status === 422) {
            const json = (await res.json()) as { error?: { message?: string } }
            setState({
              serialized: null,
              error: json.error?.message ?? 'Failed to compile MDX',
              loading: false,
            })
            return
          }
          if (!res.ok) {
            setState((prev) => ({
              serialized: prev.serialized,
              error: `Preview failed (HTTP ${res.status})`,
              loading: false,
            }))
            return
          }
          const result = (await res.json()) as MDXRemoteSerializeResult
          setState({ serialized: result, error: null, loading: false })
        })
        .catch((err: unknown) => {
          // AbortError fires when we intentionally cancel; ignore it
          // so the older keystroke doesn't flash an error.
          if (err instanceof Error && err.name === 'AbortError') return
          if (seq !== seqRef.current) return
          setState((prev) => ({
            serialized: prev.serialized,
            error:
              err instanceof Error ? err.message : 'Network error during preview',
            loading: false,
          }))
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(handle)
    }
  }, [body_md])

  // Cancel any in-flight request when the component unmounts so we
  // don't setState on an unmounted tree.
  useEffect(() => {
    return () => {
      inFlight.current?.abort()
    }
  }, [])

  return (
    <div
      className={className}
      data-testid="preview-pane"
      aria-live="polite"
      aria-busy={state.loading}
    >
      {state.loading ? (
        <div
          className="pointer-events-none absolute right-3 top-3 rounded-md border border-border bg-bg-subtle px-2 py-1 text-xs text-fg-subtle"
          data-testid="preview-loading"
        >
          compiling…
        </div>
      ) : null}

      {state.error ? (
        <div
          role="alert"
          data-testid="preview-error"
          className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          <strong className="block font-medium">Preview failed to compile</strong>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">
            {state.error}
          </pre>
        </div>
      ) : null}

      <div className="prose max-w-none">
        {state.serialized ? (
          <MDXRemote {...state.serialized} components={mdxComponents} />
        ) : !state.error && !state.loading ? (
          <p className="text-fg-subtle">Nothing to preview yet.</p>
        ) : null}
      </div>
    </div>
  )
}

export default PreviewPane
