'use client'

import { useState } from 'react'

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
  const [bio, setBio] = useState<string>(initialBio ?? '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

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
    const currentBio = initialBio ?? ''
    if (trimmedBio !== currentBio) {
      payload.bio = trimmedBio.length === 0 ? null : trimmedBio
    }
    if (avatarUrl !== initialAvatarUrl) {
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
      setSaveOk(true)
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl ?? '/icon.png'}
            alt=""
            className="settings-avatar-preview"
            width={96}
            height={96}
          />
          <label className="settings-file-input">
            <span className="settings-label">Upload new avatar</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={onAvatarChange}
              disabled={uploading || saving}
            />
          </label>
        </div>
        {uploading && (
          <p className="settings-status" role="status">
            Uploading…
          </p>
        )}
        {uploadError && (
          <p className="settings-error" role="alert">
            {uploadError}
          </p>
        )}
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
          disabled={saving || uploading}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saveOk && (
          <span className="settings-status" role="status">
            Saved.
          </span>
        )}
        {saveError && (
          <span className="settings-error" role="alert">
            Save failed: {saveError}
          </span>
        )}
      </div>
    </form>
  )
}
