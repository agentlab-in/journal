'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/tags', label: 'Tags' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/orgs', label: 'Orgs' },
  { href: '/admin/audit', label: 'Audit' },
]

export default function AdminTabs() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-4 border-b border-border" aria-label="Admin tabs">
      {tabs.map((t) => {
        const active = pathname?.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`pb-2 text-sm ${active ? 'border-b-2 border-fg text-fg font-semibold' : 'text-fg-subtle hover:text-fg'}`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
