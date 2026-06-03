'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface RestoreButtonProps {
  targetType: 'post' | 'comment'
  targetId: string
}

export default function RestoreButton({ targetType, targetId }: RestoreButtonProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function restore() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const path =
        targetType === 'post'
          ? `/api/posts/${encodeURIComponent(targetId)}/restore`
          : `/api/comments/${encodeURIComponent(targetId)}/restore`
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(typeof body?.error === 'string' ? body.error : `http_${res.status}`)
        return
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'restore_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={restore}
        disabled={busy}
        className="px-2 py-1 text-xs border border-border rounded hover:bg-bg-hover disabled:opacity-50"
      >
        {busy ? 'Restoring…' : 'Restore'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  )
}
