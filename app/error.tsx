'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to console for now — error tracking (Sentry etc.) is out of scope for v1.
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="font-mono text-sm text-fg-subtle">500</p>
      <h1 className="mt-2 font-mono text-2xl font-black lowercase tracking-tight text-fg">
        something went wrong
      </h1>
      <p className="mt-3 text-sm text-fg-subtle">
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded border border-border px-4 py-2 text-sm text-fg transition-colors hover:bg-bg-hover"
      >
        try again
      </button>
    </div>
  )
}
