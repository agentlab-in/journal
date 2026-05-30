import Link from 'next/link'
import Logo from '@/components/brand/Logo'
import ThemeToggle from './ThemeToggle'
import NavAuth from './NavAuth'
import NavSearch from './NavSearch'

export default function Nav() {
  return (
    <nav
      className="flex items-center justify-between gap-4 border-b border-border px-6 py-4"
      aria-label="Main navigation"
    >
      <Link
        href="/"
        className="flex items-center gap-2 text-fg hover:opacity-80"
        aria-label="agentlab — home"
      >
        <Logo className="h-6 w-6" />
        <span className="font-mono text-lg font-black lowercase tracking-tight">
          agentlab
        </span>
      </Link>

      <NavSearch />

      <div className="flex items-center gap-4">
        <ThemeToggle />
        <NavAuth />
      </div>
    </nav>
  )
}
