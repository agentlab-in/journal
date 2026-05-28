import Link from 'next/link'
import ThemeToggle from './ThemeToggle'

export default function Nav() {
  return (
    <nav
      className="flex items-center justify-between border-b border-border px-6 py-4"
      aria-label="Main navigation"
    >
      {/* Wordmark */}
      <Link
        href="/"
        className="font-mono text-lg font-black lowercase tracking-tight text-fg hover:opacity-80"
      >
        agentlab
      </Link>

      {/* Right side */}
      <ThemeToggle />
    </nav>
  )
}
