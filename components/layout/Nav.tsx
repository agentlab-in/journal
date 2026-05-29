import Link from 'next/link'
import Logo from '@/components/brand/Logo'
import ThemeToggle from './ThemeToggle'

export default function Nav() {
  return (
    <nav
      className="flex items-center justify-between border-b border-border px-6 py-4"
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
