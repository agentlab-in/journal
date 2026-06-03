'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'

const CONFIRM_TEXT = 'delete'

export function DeleteAccountSection() {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onDelete() {
    if (busy) return
    if (confirm !== CONFIRM_TEXT) {
      setError('confirm_required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/users/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: CONFIRM_TEXT }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `http_${res.status}`)
        return
      }
      // signOut() drops the NextAuth client cookie and redirects to home.
      await signOut({ callbackUrl: '/' })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section-heading">Delete account</h2>
      <p className="settings-help">
        Deletes your sign-in linkage and anonymises your profile (your handle
        becomes <code>deleted-xxxxxxxx</code> and your bio, avatar, display
        name, and stored GitHub email are cleared). Posts and comments you
        published stay on the platform under CC BY 4.0, attributed to the
        anonymised handle. This cannot be undone.
      </p>

      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="settings-avatar-action settings-avatar-action--danger"
        >
          Delete my account
        </button>
      ) : (
        <div className="settings-field">
          <label className="settings-field" htmlFor="delete-confirm">
            <span className="settings-label">
              Type <code>{CONFIRM_TEXT}</code> to confirm
            </span>
            <input
              id="delete-confirm"
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              disabled={busy}
              className="settings-textarea"
            />
          </label>
          <div className="settings-actions">
            <button
              type="button"
              onClick={onDelete}
              disabled={busy || confirm !== CONFIRM_TEXT}
              className="settings-avatar-action settings-avatar-action--danger"
            >
              {busy ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button
              type="button"
              onClick={() => {
                setExpanded(false)
                setConfirm('')
                setError(null)
              }}
              disabled={busy}
              className="settings-cancel"
            >
              Cancel
            </button>
            {error && (
              <span className="settings-error" role="alert">
                Delete failed: {error}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
