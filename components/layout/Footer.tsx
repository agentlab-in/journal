import Link from 'next/link'

const FOOTER_LINKS = [{ label: 'Terms', href: '/terms' }] as const

export default function Footer() {
  return (
    <footer className="border-t border-border px-6 py-4">
      <div className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          {FOOTER_LINKS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="text-xs text-fg-subtle hover:text-fg"
            >
              {label}
            </Link>
          ))}
        </div>
        <p className="text-xs text-fg-subtle">
          agentlab · built by{' '}
          <a
            href="https://theharshitsingh.com"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-fg"
          >
            Harshit Singh Bhandari
          </a>
        </p>
      </div>
    </footer>
  )
}
