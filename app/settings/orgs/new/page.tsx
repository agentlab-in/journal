/**
 * /settings/orgs/new — create-org page.
 *
 * Server component; gates on session and renders the OrgCreateForm client.
 */
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { OrgCreateForm } from '@/components/settings/OrgCreateForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'New org',
  robots: { index: false, follow: false },
}

export default async function NewOrgPage() {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/orgs/new')
  }

  return (
    <main id="main-content" className="settings-page">
      <h1 className="settings-heading">Create org</h1>
      <OrgCreateForm />
    </main>
  )
}
