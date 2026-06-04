'use client'

import { useId } from 'react'

export interface PublishAsOrgOption {
  id: string
  slug: string
  display_name: string
}

export interface PublishAsSelectProps {
  /** The signed-in author's username — shown as the "personal" option. */
  currentUsername: string
  /**
   * Orgs the caller can publish under. When empty AND mode='new' the
   * component renders nothing (no UI clutter for the common single-user
   * case). When mode='edit' it always renders so the existing identity is
   * visible (disabled, since org_id is immutable post-publish).
   */
  userOrgs?: PublishAsOrgOption[]
  /** The currently selected org_id, or `null` for the personal identity. */
  value: string | null
  onChange: (orgId: string | null) => void
  /**
   * When true the select is read-only. Set automatically in edit mode (org_id
   * cannot change after publish — see /api/posts/[id] → `org_id_immutable`).
   */
  disabled?: boolean
  /**
   * Which page is hosting the picker. `new` follows the "hide when empty"
   * rule; `edit` always renders.
   */
  mode?: 'new' | 'edit'
}

/**
 * Identity picker for the editor. Lets the author choose between publishing
 * as themselves or under one of their orgs. Per Phase 11 / T5 decision:
 * hidden entirely when the author has no orgs (new posts only) so the
 * default single-user case stays uncluttered.
 */
export function PublishAsSelect({
  currentUsername,
  userOrgs,
  value,
  onChange,
  disabled,
  mode = 'new',
}: PublishAsSelectProps) {
  const id = useId()
  const orgs = userOrgs ?? []

  // Hide entirely for new posts when the author has no orgs — there's
  // nothing to choose between, so render nothing rather than a useless
  // disabled control.
  if (orgs.length === 0 && mode === 'new') {
    return null
  }

  const selectValue = value ?? ''

  return (
    <div className="space-y-1" data-testid="publish-as-select">
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        Publish as
      </label>
      <select
        id={id}
        disabled={disabled}
        value={selectValue}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        aria-readonly={disabled ? 'true' : undefined}
        className={`w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg ${
          disabled ? 'cursor-not-allowed bg-bg-subtle opacity-80' : ''
        }`}
      >
        <option value="">@{currentUsername}</option>
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.display_name} (@{org.slug})
          </option>
        ))}
      </select>
    </div>
  )
}

export default PublishAsSelect
