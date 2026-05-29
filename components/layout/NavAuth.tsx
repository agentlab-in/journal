'use client'

import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import Image from 'next/image'

/**
 * Client component that renders the auth widget in the Nav.
 * - Unauthenticated: "Sign in" link → /auth/signin
 * - Authenticated: avatar + display name + "Sign out" button
 *
 * Kept isolated so Nav.tsx can remain a server component.
 */
export default function NavAuth() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    // Avoid layout shift — render a same-size placeholder
    return (
      <div
        className="h-8 w-20 animate-pulse rounded border border-border bg-bg"
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
  const name = user?.name ?? user?.email ?? 'account'

  return (
    <div className="flex items-center gap-3">
      {user?.image && (
        <Image
          src={user.image}
          alt={`${name} avatar`}
          width={28}
          height={28}
          className="rounded-full border border-border"
        />
      )}
      <span className="hidden font-mono text-sm text-fg sm:inline">{name}</span>
      <button
        onClick={() => signOut({ callbackUrl: '/' })}
        className="rounded border border-border px-3 py-1.5 font-mono text-sm text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
      >
        Sign out
      </button>
    </div>
  )
}
