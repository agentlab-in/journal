'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'

/**
 * Record consent for the current session user.
 *
 * Server-side validation: all four checkboxes must be 'true'. The version
 * triple is read from LEGAL_VERSIONS at submission time (NOT carried
 * through the form), so a mid-session bump is recorded against the live
 * docs.
 */
export async function recordConsent(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  const age = formData.get('age') === 'true'
  const terms = formData.get('terms') === 'true'
  const contentPolicy = formData.get('content_policy') === 'true'
  const privacyPolicy = formData.get('privacy_policy') === 'true'

  if (!age || !terms || !contentPolicy || !privacyPolicy) {
    redirect('/auth/consent?error=all_required')
  }

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = h.get('user-agent') ?? null

  const supabase = createAdminSupabaseClient()
  const { error } = await supabase.from('consents').insert({
    user_id: session.user.id,
    age_confirmed: true,
    terms_version: LEGAL_VERSIONS.terms,
    content_policy_version: LEGAL_VERSIONS.content_policy,
    privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
    ip_address: ip,
    user_agent: ua,
  })

  if (error && !/duplicate key/i.test(error.message)) {
    console.error('[consent] recordConsent insert failed:', error.message)
    redirect('/auth/consent?error=write_failed')
  }

  redirect('/')
}

/**
 * Decline consent — cancels signup.
 *
 * Order matters: delete next_auth.sessions for this user FIRST so the
 * live cookie can't act against a half-deleted user. CASCADE on
 * next_auth.users removes the accounts row and the public.users row.
 */
export async function declineConsent(): Promise<void> {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }
  const userId = session.user.id
  const supabase = createAdminSupabaseClient()

  // 1. Revoke all sessions for this user first.
  const { error: sessErr } = await supabase
    .schema('next_auth')
    .from('sessions')
    .delete()
    .eq('userId', userId)
  if (sessErr) {
    console.error('[consent] decline: session delete failed:', sessErr.message)
  }

  // 2. Delete the user row. CASCADE handles accounts + public.users.
  const { error: userErr } = await supabase
    .schema('next_auth')
    .from('users')
    .delete()
    .eq('id', userId)
  if (userErr) {
    console.error('[consent] decline: user delete failed:', userErr.message)
  }

  redirect('/auth/consent-declined')
}
