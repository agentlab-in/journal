'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Logo from '@/components/brand/Logo'
import ThemeToggle from './ThemeToggle'
import NavAuth from './NavAuth'
import NavSearch from './NavSearch'
import { LeftNav } from '@/components/home/LeftNav'

export default function Nav() {
  // Phase 13: announce the active route to assistive tech via aria-current.
  // Only the home link is currently rendered; if we add more nav entries,
  // duplicate this match check or factor out a helper.
  const pathname = usePathname()
  const isHome = pathname === '/'

  return (
    <nav
      className="flex items-center justify-between gap-4 border-b border-border px-6 py-4"
      aria-label="Main navigation"
    >
      <Link
        href="/"
        className="flex items-center gap-2 text-fg hover:opacity-80"
        aria-label="agentlab — home"
        aria-current={isHome ? 'page' : undefined}
      >
        <Logo className="h-6 w-6" />
        <span className="font-mono text-lg font-black lowercase tracking-tight">
          agentlab
        </span>
      </Link>

      <NavSearch />

      {/* LeftNav in top nav: only visible below xl (when the left sidebar is hidden).
          The .nav-leftnav CSS rule in globals.css overrides the list to flex-direction:row. */}
      <div className="nav-leftnav min-w-0 xl:hidden">
        <LeftNav />
      </div>

      <div className="flex items-center gap-4">
        <ThemeToggle />
        <NavAuth />
      </div>
    </nav>
  )
}
