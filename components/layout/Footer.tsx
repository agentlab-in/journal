import Link from 'next/link'

const FOOTER_LINKS = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Content Policy', href: '/policy' },
] as const

export default function Footer() {
  return (
    <footer className="border-t border-[var(--border)] px-6 py-4">
      <div className="flex items-center gap-6">
        {FOOTER_LINKS.map(({ label, href }) => (
          <Link
            key={href}
            href={href}
            className="text-xs text-[var(--fg-subtle)] hover:text-[var(--fg)]"
          >
            {label}
          </Link>
        ))}
      </div>
    </footer>
  )
}
