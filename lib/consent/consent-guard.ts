/**
 * Issue #57 — Consent-guard primitives.
 *
 * Pure decision (`decideConsentRedirect`) + thin Supabase read
 * (`loadLatestConsent`). Pages and API guards compose these.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  staleConsentDocs,
  type LegalDoc,
  type StoredConsentVersions,
} from '@/lib/legal/versions'

export type ConsentNeed = 'first' | 'update' | null

export interface ConsentDecision {
  needs: ConsentNeed
  staleDocs: LegalDoc[]
}

/**
 * Map a stored consent row to the redirect-required state.
 *
 * - null row → needs 'first', all three docs stale
 * - exact match → needs null, empty staleDocs
 * - any mismatch → needs 'update', list of stale docs
 *
 * Pure; safe everywhere.
 */
export function decideConsentRedirect(
  stored: StoredConsentVersions | null,
): ConsentDecision {
  const staleDocs = staleConsentDocs(stored)
  if (staleDocs.length === 0) return { needs: null, staleDocs: [] }
  return {
    needs: stored === null ? 'first' : 'update',
    staleDocs,
  }
}

/**
 * Read the latest consent row for `userId`. Returns null on no-row OR
 * any Supabase error — fail-closed; the caller will redirect to
 * /auth/consent and the user can retry from a clean state.
 */
export async function loadLatestConsent(
  supabase: SupabaseClient,
  userId: string,
): Promise<StoredConsentVersions | null> {
  try {
    const { data, error } = await supabase
      .from('consents')
      .select('terms_version, content_policy_version, privacy_policy_version')
      .eq('user_id', userId)
      .order('consented_at', { ascending: false })
      .limit(1)
      .maybeSingle<StoredConsentVersions>()
    if (error) {
      console.error('[consent-guard] loadLatestConsent error:', error.message)
      return null
    }
    return data
  } catch (err) {
    console.error('[consent-guard] loadLatestConsent threw:', err)
    return null
  }
}
