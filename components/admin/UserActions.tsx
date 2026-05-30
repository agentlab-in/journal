'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { AdminUserRow } from '@/lib/admin/search-users'

interface UserActionsProps {
  user: AdminUserRow
}

export default function UserActions({ user }: UserActionsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [banning, setBanning] = useState(false)
  const [banReason, setBanReason] = useState('')

  async function unban() {
    if (!confirm(`Unban @${user.username}?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Unban failed')
      } else {
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function submitBan() {
    if (!banReason.trim()) {
      setError('Reason is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, reason: banReason.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Ban failed')
      } else {
        setBanning(false)
        setBanReason('')
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  if (user.banned_at) {
    return (
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={unban}
          disabled={busy}
          className="text-xs px-2 py-1 border border-border rounded text-green-700 hover:bg-green-50 disabled:opacity-50"
        >
          Unban
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    )
  }

  if (banning) {
    return (
      <div className="flex flex-col gap-1">
        <input
          type="text"
          value={banReason}
          onChange={(e) => setBanReason(e.target.value)}
          placeholder="Ban reason"
          className="text-xs border border-border rounded px-2 py-1 w-48"
          disabled={busy}
        />
        <div className="flex gap-2">
          <button
            onClick={submitBan}
            disabled={busy}
            className="text-xs px-2 py-1 border border-border rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Confirm ban
          </button>
          <button
            onClick={() => { setBanning(false); setBanReason(''); setError(null) }}
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
        onClick={() => { setBanning(true); setError(null) }}
        disabled={busy}
        className="text-xs px-2 py-1 border border-border rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Ban
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
