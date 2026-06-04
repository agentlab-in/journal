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
      await signOut({ callbackUrl: '/' })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="settings-danger-zone"
      aria-labelledby="settings-danger-zone-heading"
    >
      <header className="settings-danger-zone__bar">
        <h2
          id="settings-danger-zone-heading"
          className="settings-danger-zone__title"
        >
          Danger zone
        </h2>
      </header>

      <div className="settings-danger-zone__row">
        <div className="settings-danger-zone__copy">
          <h3 className="settings-danger-zone__row-title">Delete account</h3>
          <p className="settings-danger-zone__row-body">
            Once you delete your account, the platform anonymises your handle
            (it becomes <code>deleted-xxxxxxxx</code>) and removes your
            authentication data. Posts and comments you wrote remain under the
            anonymised handle, licensed CC BY 4.0. This cannot be undone.
          </p>
        </div>
        {!expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="settings-danger-zone__button"
          >
            Delete account
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="settings-danger-zone__confirm">
          <label
            htmlFor="delete-confirm"
            className="settings-field__label"
          >
            Type <code>{CONFIRM_TEXT}</code> to confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            disabled={busy}
            className="settings-input"
          />
          <div className="settings-actions">
            <button
              type="button"
              onClick={onDelete}
              disabled={busy || confirm !== CONFIRM_TEXT}
              className="settings-danger-zone__button"
            >
              {busy ? 'Deleting…' : 'Permanently delete account'}
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
      ) : null}
    </section>
  )
}
