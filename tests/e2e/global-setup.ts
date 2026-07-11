/**
 * Issue #57 — E2E global setup.
 *
 * After the consent gate landed, every authed E2E spec needs the stub
 * user (`E2E_TEST_AUTH_USER_ID`) to have a current consent row. The
 * consent-gate spec itself clears + restores this row around each test.
 *
 * Phase 1 (approval gate, 0024_approved_users.sql) added a second write
 * gate: the stub user's github_login must also be present in
 * public.approved_users, or every write-path spec (publish, engagement,
 * comments, editor, orgs) fails closed via the enforce_author_approved
 * triggers / getSession()'s per-request approval recheck.
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

  // Phase 1 approval gate: seed the stub user's github_login into
  // approved_users so authed write specs stay green. github_login lives on
  // public.users, not on the shim session object, so look it up first.
  const { data: stubUser, error: userLookupError } = await supabase
    .from('users')
    .select('github_login')
    .eq('id', userId)
    .maybeSingle<{ github_login: string | null }>()

  if (userLookupError) {
    console.warn(`[e2e global-setup] stub user lookup failed: ${userLookupError.message}`)
  } else if (!stubUser?.github_login) {
    console.warn(
      '[e2e global-setup] stub user has no public.users row (or no github_login) yet; skipping approved_users seed',
    )
  } else {
    const { error: approvedError } = await supabase.from('approved_users').upsert(
      {
        github_login: stubUser.github_login.toLowerCase(),
        approved_at: new Date().toISOString(),
        terms_accepted_at: new Date().toISOString(),
        approved_by: 'system:e2e',
      },
      { onConflict: 'github_login', ignoreDuplicates: true },
    )

    if (approvedError) {
      console.warn(`[e2e global-setup] approved_users seed failed: ${approvedError.message}`)
    }
  }
}
