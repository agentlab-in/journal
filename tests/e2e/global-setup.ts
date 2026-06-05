/**
 * Issue #57 — E2E global setup.
 *
 * After the consent gate landed, every authed E2E spec needs the stub
 * user (`E2E_TEST_AUTH_USER_ID`) to have a current consent row. The
 * consent-gate spec itself clears + restores this row around each test.
 *
 * No-op when:
 *   - `E2E_TEST_AUTH_USER_ID` is unset, OR
 *   - real Supabase env vars are absent (CI uses placeholders that fail
 *     to connect; the DB-dependent specs already skip in that case).
 */
import { createClient } from '@supabase/supabase-js'

export default async function globalSetup(): Promise<void> {
  const userId = process.env.E2E_TEST_AUTH_USER_ID
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!userId || !supabaseUrl || !serviceKey) return
  // Placeholder URL from playwright.config.ts: don't try to write against it.
  if (supabaseUrl.endsWith('.invalid')) return

  // Resolve LEGAL_VERSIONS at setup time so the seeded row tracks
  // whatever the source-of-truth says today.
  const { LEGAL_VERSIONS } = await import('../../lib/legal/versions')

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const { error } = await supabase.from('consents').upsert(
    {
      user_id: userId,
      age_confirmed: true,
      terms_version: LEGAL_VERSIONS.terms,
      content_policy_version: LEGAL_VERSIONS.content_policy,
      privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
    },
    { onConflict: 'user_id,terms_version,content_policy_version,privacy_policy_version' },
  )

  if (error) {
    // Don't fail the entire suite for a setup blip — the consent-gate
    // spec needs a clean state anyway, and other specs surface a
    // redirect/412 if the seed truly didn't land.
    console.warn(`[e2e global-setup] consent seed failed: ${error.message}`)
  }
}
