'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { AdminOrgRow } from '@/lib/admin/search-orgs'

interface OrgActionsProps {
  org: AdminOrgRow
}

export default function OrgActions({ org }: OrgActionsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [banning, setBanning] = useState(false)
  const [banReason, setBanReason] = useState('')

  async function unban() {
    if (!confirm(`Unban org ${org.slug}?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/orgs/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id }),
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
    const trimmed = banReason.trim()
    if (!trimmed) {
      setError('Reason is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/orgs/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id, reason: trimmed }),
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

  if (org.banned_at) {
    return (
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={unban}
          disabled={busy}
          aria-label={`Unban org ${org.slug}`}
          className="text-xs px-2 py-1 border border-border rounded text-green-700 hover:bg-green-50 disabled:opacity-50"
        >
          Unban
        </button>
        {error && (
          <span className="text-xs text-red-600" role="alert">
            {error}
          </span>
        )}
      </div>
    )
  }

  if (banning) {
    return (
      <div className="flex flex-col gap-1">
        <label className="sr-only" htmlFor={`ban-reason-${org.id}`}>
          Ban reason for org {org.slug}
        </label>
        <input
          id={`ban-reason-${org.id}`}
          type="text"
          value={banReason}
          onChange={(e) => setBanReason(e.target.value)}
          placeholder="Ban reason"
          maxLength={500}
          className="text-xs border border-border rounded px-2 py-1 w-48"
          disabled={busy}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={submitBan}
            disabled={busy}
            aria-label={`Confirm ban org ${org.slug}`}
            className="text-xs px-2 py-1 border border-border rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Confirm ban
          </button>
          <button
            type="button"
            onClick={() => {
              setBanning(false)
              setBanReason('')
              setError(null)
            }}
            disabled={busy}
            aria-label="Cancel ban"
            className="text-xs px-2 py-1 border border-border rounded hover:bg-bg-hover disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && (
          <span className="text-xs text-red-600" role="alert">
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <button
        type="button"
        onClick={() => {
          setBanning(true)
          setError(null)
        }}
        disabled={busy || org.deleted_at !== null}
        aria-label={`Ban org ${org.slug}`}
        className="text-xs px-2 py-1 border border-border rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Ban
      </button>
      {error && (
        <span className="text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
