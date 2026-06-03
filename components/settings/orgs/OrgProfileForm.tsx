'use client'

/**
 * Org profile form (display_name, bio, avatar_url, cover_image_url).
 *
 * Avatar / cover are URL-input fields rather than file pickers — the
 * `/api/uploads` endpoint's owner-gating is scoped to user-owned buckets,
 * and wiring per-org upload authorization is out of scope for T5. Paste a
 * URL (e.g. an already-uploaded asset from the user's own buckets) for now;
 * dedicated org-asset upload is tracked as a follow-up.
 */
import { useState } from 'react'

export interface OrgProfileFormProps {
  slug: string
  initialDisplayName: string
  initialBio: string | null
  initialAvatarUrl: string | null
  initialCoverImageUrl: string | null
}

interface ApiError {
  error?: string
  issues?: Array<{ message?: string }>
}

export function OrgProfileForm({
  slug,
  initialDisplayName,
  initialBio,
  initialAvatarUrl,
  initialCoverImageUrl,
}: OrgProfileFormProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [bio, setBio] = useState(initialBio ?? '')
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl ?? '')
  const [coverImageUrl, setCoverImageUrl] = useState(initialCoverImageUrl ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    setError(null)
    setOk(false)
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {}
      if (displayName !== initialDisplayName) {
        payload.display_name = displayName.trim()
      }
      if (bio !== (initialBio ?? '')) {
        payload.bio = bio.trim()
      }
      if (avatarUrl !== (initialAvatarUrl ?? '')) {
        payload.avatar_url = avatarUrl.trim() === '' ? null : avatarUrl.trim()
      }
      if (coverImageUrl !== (initialCoverImageUrl ?? '')) {
        payload.cover_image_url =
          coverImageUrl.trim() === '' ? null : coverImageUrl.trim()
      }
      if (Object.keys(payload).length === 0) {
        setOk(true)
        return
      }
      const res = await fetch(`/api/orgs/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => ({}))) as ApiError
      if (!res.ok) {
        setError(
          body.issues?.[0]?.message ?? body.error ?? `Save failed (${res.status}).`,
        )
        return
      }
      setOk(true)
    } catch {
      setError('Network error.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="settings-form" onSubmit={onSubmit} data-testid="org-profile-form">
      <section className="settings-section">
        <h2 className="settings-section-heading">Profile</h2>

        <label className="settings-field">
          <span className="settings-label">Display name</span>
          <input
            type="text"
            className="settings-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
            required
          />
        </label>

        <label className="settings-field">
          <span className="settings-label">Bio</span>
          <textarea
            className="settings-textarea"
            value={bio}
            maxLength={500}
            rows={4}
            onChange={(e) => setBio(e.target.value)}
          />
        </label>
        <p className="settings-help">{bio.length}/500 characters.</p>

        <label className="settings-field">
          <span className="settings-label">Avatar URL</span>
          <input
            type="url"
            className="settings-input"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <p className="settings-help">
          Paste a hosted image URL. Dedicated org-avatar upload is on the
          roadmap.
        </p>

        <label className="settings-field">
          <span className="settings-label">Cover image URL</span>
          <input
            type="url"
            className="settings-input"
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
      </section>

      <div className="settings-actions">
        <button type="submit" className="settings-submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {ok ? (
          <span className="settings-status" role="status">
            Saved.
          </span>
        ) : null}
        {error ? (
          <span className="settings-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  )
}

export default OrgProfileForm
