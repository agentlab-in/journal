'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { PendingTagRow } from '@/lib/admin/list-tags'

interface TagActionsProps {
  tag: PendingTagRow
}

export default function TagActions({ tag }: TagActionsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  async function approve() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/tags/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: tag.slug }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Approve failed')
      } else {
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function submitReject() {
    if (!rejectReason.trim()) {
      setError('Reason is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/tags/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: tag.slug, reason: rejectReason.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Reject failed')
      } else {
        setRejecting(false)
        setRejectReason('')
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  if (rejecting) {
    return (
      <div className="flex flex-col gap-1">
        <input
          type="text"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Rejection reason"
          className="text-xs border border-border rounded px-2 py-1 w-48"
          disabled={busy}
        />
        <div className="flex gap-2">
          <button
            onClick={submitReject}
            disabled={busy}
            className="text-xs px-2 py-1 border border-border rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Confirm reject
          </button>
          <button
            onClick={() => { setRejecting(false); setRejectReason(''); setError(null) }}
            disabled={busy}
            className="text-xs px-2 py-1 border border-border rounded hover:bg-surface-raised disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <button
        onClick={approve}
        disabled={busy}
        className="text-xs px-2 py-1 border border-border rounded text-green-700 hover:bg-green-50 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        onClick={() => { setRejecting(true); setError(null) }}
        disabled={busy}
        className="text-xs px-2 py-1 border border-border rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Reject
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
