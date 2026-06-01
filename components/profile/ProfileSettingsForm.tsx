'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const MAX_BIO = 2000

export interface ProfileSettingsFormProps {
  username: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
}

type UploadError =
  | 'file_too_large'
  | 'unsupported_type'
  | 'dimensions_too_large'
  | 'no_file'
  | 'invalid_bucket'
  | 'upload_failed'
  | 'unknown'

function uploadErrorMessage(err: UploadError): string {
  switch (err) {
    case 'file_too_large':
      return 'Image is larger than 2MB. Pick a smaller file.'
    case 'unsupported_type':
      return 'Unsupported image type. Use JPEG, PNG, WebP, or GIF.'
    case 'dimensions_too_large':
      return 'Image is too large in dimensions (max 6000×6000).'
    case 'no_file':
      return 'No file selected.'
    case 'invalid_bucket':
      return 'Upload destination is invalid.'
    case 'upload_failed':
      return 'Upload failed. Try again.'
    default:
      return 'Upload failed.'
  }
}

export function ProfileSettingsForm({
  username,
  displayName,
  bio: initialBio,
  avatarUrl: initialAvatarUrl,
}: ProfileSettingsFormProps) {
  const router = useRouter()
  const [bio, setBio] = useState<string>(initialBio ?? '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  // The "baseline" the dirty check compares against. Seeded from the
  // server-rendered props and bumped to the latest values after every
  // successful save — without this, an Edit → Save → Edit cycle would
  // keep showing "Unsaved" because we'd still be diffing against the
  // long-stale initial render.
  const [savedBio, setSavedBio] = useState<string>(initialBio ?? '')
  const [savedAvatarUrl, setSavedAvatarUrl] =
    useState<string | null>(initialAvatarUrl)

  // The visible file input is replaced by a clickable avatar + button row.
  // The actual <input type="file"> is hidden but kept in the DOM so the
  // file-picker dialog is owned by the browser (no custom picker).
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Post-save redirect to the profile page after a brief "Saved." flash —
  // cleared on unmount so we don't router.push() into a torn-down component.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
    }
  }, [])

  const hasUnsavedChanges =
    bio.trim() !== savedBio || avatarUrl !== savedAvatarUrl

  // Browser-level guard: native beforeunload prompt when the user tries to
  // close the tab, navigate via URL bar, or refresh with unsaved edits. The
  // browser owns the dialog copy in modern engines (Chrome 51+, Safari 9.1+);
  // we just have to call preventDefault + set returnValue to opt in.
  // NOTE: doesn't fire on in-app <Link> navigation (Cancel button, post-save
  // redirect) — that path is a Next.js router-intercept problem we're not
  // solving here.
  useEffect(() => {
    if (!hasUnsavedChanges) return
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges])

  function openFilePicker() {
    if (uploading || saving) return
    fileInputRef.current?.click()
  }

  function removeAvatar() {
    if (uploading || saving) return
    setAvatarUrl(null)
    setUploadError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/uploads?bucket=avatars', {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setUploadError(uploadErrorMessage((body.error as UploadError) ?? 'unknown'))
        return
      }
      const body = (await res.json()) as { url: string }
      setAvatarUrl(body.url)
    } catch {
      setUploadError(uploadErrorMessage('upload_failed'))
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    setSaveError(null)
    setSaveOk(false)

    const payload: Record<string, unknown> = {}
    const trimmedBio = bio.trim()
    if (trimmedBio !== savedBio) {
      payload.bio = trimmedBio.length === 0 ? null : trimmedBio
    }
    if (avatarUrl !== savedAvatarUrl) {
      payload.avatar_url = avatarUrl
    }

    if (Object.keys(payload).length === 0) {
      setSaveOk(true)
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setSaveError(body.error ?? 'save_failed')
        return
      }
      // Bump the baseline so the next dirty-check diffs against what's
      // actually persisted on the server, not the long-stale initial props.
      setSavedBio(trimmedBio)
      setSavedAvatarUrl(avatarUrl)
      setSaveOk(true)
      // Give the user a moment to see "Saved." before navigating away.
      redirectTimerRef.current = setTimeout(() => {
        router.push(`/${username}`)
      }, 600)
    } catch {
      setSaveError('save_failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <section className="settings-section">
        <h2 className="settings-section-heading">Identity</h2>
        <p className="settings-readonly-row">
          <span className="settings-label">Display name</span>
          <span className="settings-value">{displayName}</span>
        </p>
        <p className="settings-readonly-row">
          <span className="settings-label">Username</span>
          <span className="settings-value">@{username}</span>
        </p>
        <p className="settings-help">
          Display name and username are immutable in v1.
        </p>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-heading">Avatar</h2>
        <div className="settings-avatar-row">
          {/* The avatar itself is the primary upload trigger — clicking
              opens the file picker. The "Replace" button below is a
              keyboard/touch-discoverable mirror of the same action. */}
          <button
            type="button"
            className="settings-avatar-trigger"
            onClick={openFilePicker}
            disabled={uploading || saving}
            aria-label={avatarUrl ? 'Change avatar' : 'Upload avatar'}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl ?? '/icon.png'}
              alt={`Current avatar for @${username}`}
              className="settings-avatar-preview"
              width={96}
              height={96}
            />
            <span
              aria-hidden="true"
              className={`settings-avatar-overlay${uploading ? ' settings-avatar-overlay--busy' : ''}`}
            >
              {uploading ? 'Uploading…' : avatarUrl ? 'Change' : 'Upload'}
            </span>
          </button>

          <div className="settings-avatar-controls">
            <div className="settings-avatar-actions">
              <button
                type="button"
                className="settings-avatar-action"
                onClick={openFilePicker}
                disabled={uploading || saving}
              >
                {avatarUrl ? 'Replace' : 'Upload'}
              </button>
              {avatarUrl ? (
                <button
                  type="button"
                  className="settings-avatar-action settings-avatar-action--danger"
                  onClick={removeAvatar}
                  disabled={uploading || saving}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <p className="settings-avatar-help">
              JPEG, PNG, WebP, or GIF · max 2MB.
            </p>
            {/* Avatar-specific "unsaved" microcopy removed — the global
                indicator in the actions row + the beforeunload guard now
                cover this. */}
          </div>

          {/* Real input lives off-screen; only the button row above is
              visible. tabIndex=-1 keeps it out of the tab order (the
              wrapping button is the keyboard target). */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={onAvatarChange}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
        {/* Screen-reader announcement during upload (the visible overlay is
            aria-hidden so this is the channel assistive tech listens to). */}
        {uploading ? (
          <span className="sr-only" role="status">
            Uploading avatar…
          </span>
        ) : null}
        {uploadError ? (
          <p className="settings-error" role="alert">
            {uploadError}
          </p>
        ) : null}
      </section>

      <section className="settings-section">
        <h2 className="settings-section-heading">Bio</h2>
        <label className="settings-field">
          <span className="settings-label">About you</span>
          <textarea
            className="settings-textarea"
            value={bio}
            maxLength={MAX_BIO}
            rows={6}
            onChange={(e) => setBio(e.target.value)}
            disabled={saving}
          />
        </label>
        <p className="settings-help">
          Markdown supported. {bio.length}/{MAX_BIO} characters.
        </p>
      </section>

      <div className="settings-actions">
        <button
          type="submit"
          className="settings-submit"
          disabled={saving || uploading || !hasUnsavedChanges}
          title={hasUnsavedChanges ? undefined : 'No changes to save'}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <Link href={`/${username}`} className="settings-cancel">
          Cancel
        </Link>
        {/* Indicators are mutually exclusive: editing after a save flips
            us back into the "unsaved" state and replaces the "Saved." chip. */}
        {hasUnsavedChanges ? (
          <span className="settings-unsaved" role="status">
            You have unsaved changes.
          </span>
        ) : saveOk ? (
          <span className="settings-status" role="status">
            Saved.
          </span>
        ) : null}
        {saveError && (
          <span className="settings-error" role="alert">
            Save failed: {saveError}
          </span>
        )}
      </div>
    </form>
  )
}
