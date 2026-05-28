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
      <div className="flex items-center gap-4">
        <ThemeToggle />
        {/* Auth: placeholder — GitHub OAuth implemented in Phase 1 */}
        <button
          className="rounded border border-border px-3 py-1.5 text-sm text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
          disabled
          title="Auth coming in Phase 1"
          aria-label="Sign in with GitHub — coming soon"
        >
          Sign in with GitHub
        </button>
      </div>
    </nav>
  )
}
