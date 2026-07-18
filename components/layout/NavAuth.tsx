'use client'

import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import ProfileMenu from './ProfileMenu'

/**
 * Client component that renders the auth widget in the Nav.
 * - Unauthenticated: "Sign in" link → /auth/signin
 * - Authenticated:   primary "Write" CTA + avatar dropdown (Profile /
 *                    Settings / Sign out)
 *
 * Why a primary CTA + dropdown: pre-cleanup the nav had four flat actions
 * (profile chip, Write, Bookmarks, Sign out) all in the same ghost-button
 * style — every action competed for attention equally. Grouping the
 * secondary actions behind the avatar leaves "Write" as the only weighted
 * surface, matching the publishing-first product intent.
 */
export default function NavAuth() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    // Same-size placeholder to avoid layout shift while NextAuth resolves.
    // Width matches Write button (~4rem) + gap + avatar (1.75rem) ≈ 7rem.
    return (
      <div
        className="h-8 w-28 animate-pulse rounded border border-border bg-bg"
        aria-hidden="true"
      />
    )
  }

  if (status === 'unauthenticated' || !session) {
    return (
      <Link
        href="/auth/signin"
        className="rounded border border-border px-3 py-1.5 font-mono text-sm text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
      >
        Sign in
      </Link>
    )
  }

  const { user } = session
  const username = user?.username ?? null
  const displayName = user?.name ?? user?.email ?? 'account'

  // Degraded path: signed in but no username on the session (shouldn't
  // happen in normal flow — the next-auth callback always sets it — but
  // we keep a Sign-out escape hatch so a user can't get stranded).
  if (!username) {
    return (
      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: '/' })}
        className="rounded border border-border px-3 py-1.5 font-mono text-sm text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
      >
        Sign out
      </button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {/* Primary CTA — solid inverted button, the only visually weighted
          surface in the nav. */}
      <Link
        href="/write"
        className="rounded-md bg-fg px-3 py-1.5 font-mono text-sm font-medium text-bg transition-opacity hover:opacity-90"
      >
        Write
      </Link>
      <ProfileMenu
        username={username}
        displayName={displayName}
        avatarUrl={user?.image ?? null}
      />
    </div>
  )
}
