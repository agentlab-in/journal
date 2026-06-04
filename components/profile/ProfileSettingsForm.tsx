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

  // The "baseline" the dirty check compares against. Bumped after every
  // successful save so an Edit → Save → Edit cycle doesn't keep showing the
  // "unsaved" indicator against long-stale initial props.
  const [savedBio, setSavedBio] = useState<string>(initialBio ?? '')
  const [savedAvatarUrl, setSavedAvatarUrl] =
    useState<string | null>(initialAvatarUrl)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
    }
  }, [])

  const hasUnsavedChanges =
    bio.trim() !== savedBio || avatarUrl !== savedAvatarUrl

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
      setSavedBio(trimmedBio)
      setSavedAvatarUrl(avatarUrl)
      setSaveOk(true)
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
    <form className="settings-form" onSubmit={onSubmit} aria-labelledby="settings-public-profile-heading">
      <section className="settings-public-profile">
        <header className="settings-section-bar">
          <h2 id="settings-public-profile-heading" className="settings-section-title">
            Public profile
          </h2>
        </header>

        <div className="settings-public-profile__grid">
          {/* LEFT — form fields */}
          <div className="settings-public-profile__main">
            <div className="settings-field">
              <label htmlFor="settings-name" className="settings-field__label">
                Name
              </label>
              <input
                id="settings-name"
                type="text"
                value={displayName}
                readOnly
                aria-readonly="true"
                aria-describedby="settings-name-help"
                className="settings-input settings-input--readonly"
              />
              <p id="settings-name-help" className="settings-field__help">
                Set permanently from your GitHub display name at first sign-in. Not editable.
              </p>
            </div>

            <div className="settings-field">
              <label htmlFor="settings-username" className="settings-field__label">
                Username
              </label>
              <input
                id="settings-username"
                type="text"
                value={`@${username}`}
                readOnly
                aria-readonly="true"
                aria-describedby="settings-username-help"
                className="settings-input settings-input--readonly"
              />
              <p id="settings-username-help" className="settings-field__help">
                Tied to your GitHub login. Username changes are not supported.
              </p>
            </div>

            <div className="settings-field">
              <label htmlFor="settings-bio" className="settings-field__label">
                Bio
              </label>
              <textarea
                id="settings-bio"
                value={bio}
                maxLength={MAX_BIO}
                rows={5}
                onChange={(e) => setBio(e.target.value)}
                disabled={saving}
                aria-describedby="settings-bio-help"
                className="settings-input settings-input--textarea"
              />
              <p id="settings-bio-help" className="settings-field__help">
                Supports markdown. Visible on your public profile.{' '}
                <span className="settings-field__counter">
                  {bio.length}/{MAX_BIO}
                </span>
              </p>
            </div>

            <div className="settings-actions">
              <button
                type="submit"
                className="settings-submit"
                disabled={saving || uploading || !hasUnsavedChanges}
                title={hasUnsavedChanges ? undefined : 'No changes to save'}
              >
                {saving ? 'Saving…' : 'Update profile'}
              </button>
              <Link href={`/${username}`} className="settings-cancel">
                Cancel
              </Link>
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
          </div>

          {/* RIGHT — avatar sidebar */}
          <aside className="settings-public-profile__sidebar">
            <h3 className="settings-field__label">Profile picture</h3>
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
                width={260}
                height={260}
              />
              <span
                aria-hidden="true"
                className={`settings-avatar-overlay${uploading ? ' settings-avatar-overlay--busy' : ''}`}
              >
                {uploading ? 'Uploading…' : avatarUrl ? 'Change' : 'Upload'}
              </span>
            </button>

            <div className="settings-avatar-actions">
              <button
                type="button"
                className="settings-avatar-action"
                onClick={openFilePicker}
                disabled={uploading || saving}
              >
                {avatarUrl ? 'Edit' : 'Upload'}
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
            <p className="settings-field__help">
              JPEG, PNG, WebP, or GIF · max 2MB. Recommended ≥400×400. EXIF stripped; stored as WebP.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={onAvatarChange}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />

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
          </aside>
        </div>
      </section>
    </form>
  )
}
