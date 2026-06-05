import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadLatestConsent, decideConsentRedirect } from '@/lib/consent/consent-guard'
import { ConsentForm } from './ConsentForm'

export const metadata: Metadata = {
  title: 'Review and consent',
  robots: { index: false, follow: false },
}

interface PageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function ConsentPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  const supabase = createAdminSupabaseClient()
  const stored = await loadLatestConsent(supabase, session.user.id)
  const decision = decideConsentRedirect(stored)

  if (decision.needs === null) {
    // Already fully consented — page is navigable but pointless. Send home.
    redirect('/')
  }

  const sp = await searchParams
  const error = sp.error ?? null

  return (
    <main id="main-content" className="settings-page">
      <h1 className="settings-heading">Before you continue</h1>
      <p className="settings-help">
        {decision.needs === 'first'
          ? 'To use agentlab.in, please confirm the following:'
          : 'We updated our policies. Please review and confirm:'}
      </p>
      {error === 'all_required' && (
        <p role="alert" className="settings-error">
          All four boxes are required.
        </p>
      )}
      {error === 'write_failed' && (
        <p role="alert" className="settings-error">
          Something went wrong recording your consent. Please try again.
        </p>
      )}
      <ConsentForm />
    </main>
  )
}
