/**
 * Issue #57 — authed-page helper.
 *
 * Call right after getSession() in any server component that requires
 * a consented user. Pass-through on consent; throws via Next's redirect
 * otherwise (Next treats redirect as a control-flow throw).
 */
import { redirect } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadLatestConsent, decideConsentRedirect } from '@/lib/consent/consent-guard'

export async function requireConsentOrRedirect(userId: string): Promise<void> {
  const supabase = createAdminSupabaseClient()
  const stored = await loadLatestConsent(supabase, userId)
  const decision = decideConsentRedirect(stored)
  if (decision.needs !== null) {
    redirect('/auth/consent')
  }
}
