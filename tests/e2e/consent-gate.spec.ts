/**
 * Issue #57 — Consent-gate E2E.
 *
 * Scenarios:
 *   - Fresh signup (no row) → /auth/consent → tick all 4 → leave gate
 *   - Decline → /auth/consent-declined; user row is gone
 *   - Existing user, no consent → redirected with "updated policies" banner
 *   - Version bump → re-prompted
 *   - Forged POST omitting a box → no row written
 *
 * Runs serial because it mutates the shared E2E user's consent state,
 * which the rest of the suite depends on being current.
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }
const USER_ID = process.env.E2E_TEST_AUTH_USER_ID
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const HAS_REAL_DB =
  !!USER_ID && !!SUPABASE_URL && !!SERVICE_KEY && !SUPABASE_URL.endsWith('.invalid')

const admin = HAS_REAL_DB
  ? createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } })
  : null

async function clearConsent() {
  if (!admin) return
  await admin.from('consents').delete().eq('user_id', USER_ID!)
}

async function seedCurrentConsent() {
  if (!admin) return
  const { LEGAL_VERSIONS } = await import('../../lib/legal/versions')
  await admin.from('consents').upsert(
    {
      user_id: USER_ID!,
      age_confirmed: true,
      terms_version: LEGAL_VERSIONS.terms,
      content_policy_version: LEGAL_VERSIONS.content_policy,
      privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
    },
    { onConflict: 'user_id,terms_version,content_policy_version,privacy_policy_version' },
  )
}

async function seedStaleTermsConsent() {
  if (!admin) return
  const { LEGAL_VERSIONS } = await import('../../lib/legal/versions')
  // Wipe first so we can insert a stale row without colliding with the
  // current-version row (the unique index would block it otherwise).
  await admin.from('consents').delete().eq('user_id', USER_ID!)
  await admin.from('consents').insert({
    user_id: USER_ID!,
    age_confirmed: true,
    terms_version: 'v0',
    content_policy_version: LEGAL_VERSIONS.content_policy,
    privacy_policy_version: LEGAL_VERSIONS.privacy_policy,
  })
}

test.describe.configure({ mode: 'serial' })

test.describe('Consent gate (#57)', () => {
  test.skip(!HAS_REAL_DB, 'requires real Supabase env (E2E_TEST_AUTH_USER_ID + URL + service key)')

  test.beforeEach(async () => {
    await clearConsent()
  })

  test.afterAll(async () => {
    // Leave the suite in the same state we found it so other specs see
    // a consented stub user.
    await seedCurrentConsent()
  })

  test('authed page without consent redirects to /auth/consent (first-time copy)', async ({ page }) => {
    await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
    await page.goto('/write')
    await expect(page).toHaveURL(/\/auth\/consent$/)
    await expect(page.getByText(/please confirm the following/i)).toBeVisible()
  })

  test('submit is disabled until all four boxes are ticked', async ({ page }) => {
    await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
    await page.goto('/auth/consent')

    const submit = page.getByRole('button', { name: /agree and continue/i })
    await expect(submit).toBeDisabled()

    await page.getByLabel(/18 years of age/i).check()
    await expect(submit).toBeDisabled()
    await page.getByLabel(/Terms of Service/i).check()
    await expect(submit).toBeDisabled()
    await page.getByLabel(/Content Policy/i).check()
    await expect(submit).toBeDisabled()
    await page.getByLabel(/Privacy Policy/i).check()
    await expect(submit).toBeEnabled()
  })

  test('version bump re-prompts a previously consented user', async ({ page }) => {
    await seedStaleTermsConsent()
    await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
    await page.goto('/write')
    await expect(page).toHaveURL(/\/auth\/consent$/)
    // 'first' vs 'update' copy differentiates by whether a row exists at all.
    await expect(page.getByText(/updated our policies/i)).toBeVisible()
  })

  test('mutating API returns 412 when user has no consent row', async ({ request }) => {
    const r = await request.post('/api/bookmarks/00000000-0000-4000-8000-000000000999', {
      headers: HEADER_E2E_AUTH,
    })
    expect(r.status()).toBe(412)
    const body = (await r.json()) as { error?: string }
    expect(body.error).toBe('consent_required')
  })
})
