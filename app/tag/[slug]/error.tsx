'use client'

/**
 * Route-level error boundary for /tag/[slug] — catches tag-page query
 * failures and renders friendly copy + try-again.
 *
 * Note: never render `error.message` / `error.stack`. The `digest` is
 * the Next.js correlation id and is safe to expose for support.
 */

import { useEffect } from 'react'
import Link from 'next/link'

export default function TagError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main id="main-content" className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="font-mono text-sm text-fg-subtle">500</p>
      <h1 className="mt-2 font-mono text-2xl font-black lowercase tracking-tight text-fg">
        couldn&apos;t load this tag
      </h1>
      <p className="mt-3 text-sm text-fg-subtle">
        Something went wrong while loading posts for this tag. Please try
        again.
      </p>
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={reset}
          className="rounded border border-border px-4 py-2 text-sm text-fg transition-colors hover:bg-bg-hover"
        >
          try again
        </button>
        <Link
          href="/"
          className="text-sm text-fg underline underline-offset-4 hover:opacity-70"
        >
          back to agentlab
        </Link>
      </div>
    </main>
  )
}
