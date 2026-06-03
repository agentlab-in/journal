'use client'

/**
 * /settings/orgs/new — create-org form.
 *
 * Posts to `POST /api/orgs` and redirects to the new org's settings page on
 * success. Surfaces `slug_taken` and `invalid_body` API errors inline so
 * the author doesn't have to inspect a network panel.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

interface ApiIssue {
  path?: (string | number)[]
  message?: string
}

interface ApiError {
  error?: string
  reason?: string
  issues?: ApiIssue[]
}

export function OrgCreateForm() {
  const router = useRouter()
  const [slug, setSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function clientValidate(): string | null {
    if (slug.length < 2 || slug.length > 30) {
      return 'Slug must be 2-30 characters.'
    }
    if (!SLUG_REGEX.test(slug)) {
      return 'Slug must be lowercase letters, numbers, and dashes (no leading/trailing dash).'
    }
    if (displayName.trim().length === 0 || displayName.length > 60) {
      return 'Display name is required (1-60 characters).'
    }
    if (bio.length > 500) {
      return 'Bio must be 500 characters or fewer.'
    }
    return null
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    const local = clientValidate()
    if (local) {
      setError(local)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          display_name: displayName.trim(),
          ...(bio.trim() ? { bio: bio.trim() } : {}),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as ApiError
      if (!res.ok) {
        if (body.error === 'slug_taken') {
          const reason = body.reason ?? 'taken'
          setError(`That slug is already in use (${reason}).`)
        } else if (body.error === 'invalid_body' && body.issues?.[0]) {
          const issue = body.issues[0]
          setError(issue.message ?? 'Invalid input.')
        } else {
          setError(body.error ?? `Create failed (status ${res.status}).`)
        }
        return
      }
      router.push(`/settings/orgs/${slug}`)
    } catch {
      setError('Network error. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="settings-form" onSubmit={onSubmit} data-testid="org-create-form">
      <section className="settings-section">
        <h2 className="settings-section-heading">New org</h2>
        <label className="settings-field">
          <span className="settings-label">Slug</span>
          <input
            type="text"
            className="settings-input"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="e.g. acme"
            autoComplete="off"
            required
          />
        </label>
        <p className="settings-help">
          Lowercase letters, numbers, and dashes. Used in the org&apos;s URL:
          agentlab.in/{slug || 'your-slug'}/
        </p>

        <label className="settings-field">
          <span className="settings-label">Display name</span>
          <input
            type="text"
            className="settings-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Acme Research"
            required
          />
        </label>

        <label className="settings-field">
          <span className="settings-label">Bio</span>
          <textarea
            className="settings-textarea"
            value={bio}
            maxLength={500}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
          />
        </label>
        <p className="settings-help">Optional. {bio.length}/500 characters.</p>
      </section>

      <div className="settings-actions">
        <button
          type="submit"
          className="settings-submit"
          disabled={submitting}
        >
          {submitting ? 'Creating…' : 'Create org'}
        </button>
        <Link href="/settings/profile" className="settings-cancel">
          Cancel
        </Link>
        {error ? (
          <span className="settings-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  )
}

export default OrgCreateForm
