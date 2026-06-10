'use client'

/**
 * LeftNav — section-level navigation links.
 *
 * Intentionally takes NO props. This component is rendered both inside the
 * left sidebar (desktop xl+) and inside the top nav (below xl, via
 * Nav.tsx's `.nav-leftnav` wrapper). The no-props contract lets both
 * rendering sites stay in sync automatically.
 *
 * Item order (OPC-8, locked — do not reorder):
 *   Home → Trending → All tags → Bookmarks → Profile
 *
 * No Settings entry (OPC-3, decided).
 * No icons/emoji (brand: mono text labels only).
 *
 * Active route: exact pathname match marks the link `aria-current="page"`.
 * Session-gated items (Bookmarks, Profile) only render when authenticated.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

const PUBLIC_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/trending', label: 'Trending' },
  { href: '/tags', label: 'All tags' },
] as const

export function LeftNav() {
  const pathname = usePathname()
  const { data: session } = useSession()

  const username = session?.user?.username ?? null

  return (
    <nav aria-label="Section navigation">
      <ul className="left-nav__list">
        {PUBLIC_ITEMS.map(({ href, label }) => (
          <li key={href} className="left-nav__item">
            <Link
              href={href}
              className="left-nav__link"
              aria-current={pathname === href ? 'page' : undefined}
            >
              {label}
            </Link>
          </li>
        ))}

        {session && (
          <li className="left-nav__item">
            <Link
              href="/bookmarks"
              className="left-nav__link"
              aria-current={pathname === '/bookmarks' ? 'page' : undefined}
            >
              Bookmarks
            </Link>
          </li>
        )}

        {session && username && (
          <li className="left-nav__item">
            <Link
              href={`/${username}`}
              className="left-nav__link"
              aria-current={pathname === `/${username}` ? 'page' : undefined}
            >
              Profile
            </Link>
          </li>
        )}
      </ul>
    </nav>
  )
}
