'use client'

/**
 * Soft-delete (org) danger zone — confirms via `window.confirm`, posts
 * DELETE /api/orgs/[slug], and redirects to /settings on success.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface OrgDangerZoneProps {
  slug: string
  displayName: string
}

export function OrgDangerZone({ slug, displayName }: OrgDangerZoneProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (busy) return
    const ok = window.confirm(
      `Delete ${displayName}? This soft-deletes the org and hides all of its posts.`,
    )
    if (!ok) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/orgs/${slug}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Delete failed (${res.status}).`)
        return
      }
      router.push('/settings/profile')
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="settings-section settings-section--danger"
      data-testid="org-danger-zone"
    >
      <h2 className="settings-section-heading">Danger zone</h2>
      <p className="settings-help">
        Soft-deletes the org. Posts published under this org will stop
        appearing in feeds. Members are not removed from the roster.
      </p>
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={busy}
        className="settings-submit settings-submit--danger"
      >
        {busy ? 'Deleting…' : 'Delete org'}
      </button>
      {error ? (
        <span className="settings-error" role="alert">
          {error}
        </span>
      ) : null}
    </section>
  )
}

export default OrgDangerZone
