'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { signOut } from 'next-auth/react'

interface ProfileMenuProps {
  username: string
  displayName: string
  avatarUrl: string | null
}

/**
 * Avatar-triggered dropdown for authenticated users. Groups the secondary
 * account actions (Profile / Settings / Sign out) into a single menu so
 * the top-nav surfaces only the primary "Write" CTA next to it.
 *
 * No Radix / headless-ui dependency — the menu is small enough to roll
 * locally and the project brand explicitly avoids generic component
 * libraries. Closes on outside-click and Escape.
 */
export default function ProfileMenu({
  username,
  displayName,
  avatarUrl,
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initial = displayName.trim().charAt(0).toUpperCase() || '?'

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
        className="flex items-center rounded-full border border-border transition-opacity hover:opacity-80"
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={28}
            height={28}
            className="rounded-full"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-full bg-bg-subtle text-xs font-semibold text-fg-subtle"
          >
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-md border border-border bg-bg shadow-lg"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate font-mono text-sm font-semibold text-fg">
              {displayName}
            </p>
            <p className="truncate font-mono text-xs text-fg-subtle">
              @{username}
            </p>
          </div>
          <Link
            href={`/${username}`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 font-mono text-sm text-fg hover:bg-bg-hover"
          >
            Profile
          </Link>
          <Link
            href="/settings/profile#orgs"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 font-mono text-sm text-fg hover:bg-bg-hover"
          >
            Your orgs
          </Link>
          <Link
            href="/settings/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 font-mono text-sm text-fg hover:bg-bg-hover"
          >
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void signOut({ callbackUrl: '/' })
            }}
            className="block w-full border-t border-border px-3 py-2 text-left font-mono text-sm text-fg hover:bg-bg-hover"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
