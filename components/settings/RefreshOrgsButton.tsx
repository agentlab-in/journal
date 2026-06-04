'use client'

/**
 * Phase 11.5 follow-up — "Refresh from GitHub" button.
 *
 * Orgs are GitHub-backed and materialized by lib/orgs/github-sync on every
 * sign-in (via the events.signIn callback in lib/auth.ts). If a user joins a
 * GitHub org after their last sign-in, they previously had to sign out and
 * sign back in to pick it up. This button triggers next-auth's signIn() with
 * the GitHub provider, which re-runs the OAuth dance (usually silent if the
 * app is already authorized) and re-runs the sync. The redirect lands the
 * user back at /settings/profile#orgs with a fresh list.
 */
import { useState } from 'react'
import { signIn } from 'next-auth/react'

export interface RefreshOrgsButtonProps {
  className?: string
}

export function RefreshOrgsButton({ className }: RefreshOrgsButtonProps) {
  const [isLoading, setIsLoading] = useState(false)

  async function onClick() {
    if (isLoading) return
    setIsLoading(true)
    try {
      await signIn('github', { callbackUrl: '/settings/profile#orgs' })
    } finally {
      // signIn() navigates away, so in practice this rarely runs — but if the
      // redirect is blocked or signIn rejects, restore the button.
      setIsLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      className={className ?? 'settings-avatar-action'}
      data-testid="refresh-orgs-button"
    >
      {isLoading ? 'Refreshing…' : 'Refresh from GitHub'}
    </button>
  )
}

export default RefreshOrgsButton
