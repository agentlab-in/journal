'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ReportListRow } from '@/lib/admin/list-reports'

interface ReportActionsProps {
  report: ReportListRow
}

export default function ReportActions({ report }: ReportActionsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function dismiss() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/reports/${report.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'dismissed' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to dismiss')
      } else {
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function deleteTarget() {
    if (!confirm('Delete this content and resolve the report?')) return
    setBusy(true)
    setError(null)
    try {
      // Delete the target content
      let deleteUrl = ''
      if (report.target_type === 'post') {
        deleteUrl = `/api/posts/${report.target_id}`
      } else if (report.target_type === 'comment') {
        deleteUrl = `/api/comments/${report.target_id}`
      }

      if (deleteUrl) {
        const deleteRes = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: `Admin action on report ${report.id}` }),
        })
        if (!deleteRes.ok) {
          const body = await deleteRes.json().catch(() => ({}))
          // 404 = already deleted, continue to resolve
          if (deleteRes.status !== 404) {
            setError(body.error ?? 'Delete failed')
            setBusy(false)
            return
          }
        }
      }

      // Resolve the report as actioned
      const resolveRes = await fetch(`/api/admin/reports/${report.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'actioned' }),
      })
      if (!resolveRes.ok) {
        const body = await resolveRes.json().catch(() => ({}))
        setError(body.error ?? 'Resolve failed')
      } else {
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function banUser() {
    const reason = prompt('Ban reason (required):')
    if (!reason?.trim()) return
    setBusy(true)
    setError(null)
    try {
      const banRes = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: report.target_id, reason: reason.trim() }),
      })
      if (!banRes.ok) {
        const body = await banRes.json().catch(() => ({}))
        setError(body.error ?? 'Ban failed')
        setBusy(false)
        return
      }

      const resolveRes = await fetch(`/api/admin/reports/${report.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'actioned' }),
      })
      if (!resolveRes.ok) {
        const body = await resolveRes.json().catch(() => ({}))
        setError(body.error ?? 'Resolve failed')
      } else {
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <button
        onClick={dismiss}
        disabled={busy}
        className="text-xs px-2 py-1 border border-border rounded hover:bg-surface-raised disabled:opacity-50"
      >
        Dismiss
      </button>

      {(report.target_type === 'post' || report.target_type === 'comment') && (
        <button
          onClick={deleteTarget}
          disabled={busy}
          className="text-xs px-2 py-1 border border-border rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Delete + resolve
        </button>
      )}

      {report.target_type === 'user' && (
        <button
          onClick={banUser}
          disabled={busy}
          className="text-xs px-2 py-1 border border-border rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Ban + resolve
        </button>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
