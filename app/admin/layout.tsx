import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import AdminTabs from '@/components/admin/AdminTabs'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Admin — agentlab.in',
  robots: { index: false },
}

// Re-validate every request so newly banned users / new reports show up.
export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  await requireAdmin(session) // throws notFound() on non-admin
  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="font-mono text-2xl font-black lowercase tracking-tight text-fg mb-4">
        admin
      </h1>
      <AdminTabs />
      <div className="mt-6">{children}</div>
    </main>
  )
}
