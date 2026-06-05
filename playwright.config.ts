import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — Phase 3 Task 11.
 *
 * The `webServer` block boots `pnpm dev` and forwards two opt-in test hooks:
 *
 *   E2E_TEST_AUTH_USER_ID  — when set, `getSession()` in `lib/auth.ts`
 *                            returns a stub session for requests that ALSO
 *                            carry the `x-e2e-auth: 1` header (so the
 *                            unauth-redirect test still sees no session).
 *                            The shim is additionally NODE_ENV-gated so a
 *                            prod build cannot enable it even if this env
 *                            var leaks.
 *   E2E_AUTOSAVE_MS        — when set, `/write` forwards it to the
 *                            `DraftManager` `autoSaveMs` prop so the
 *                            debounce is short enough for a test loop.
 *
 * DB-dependent tests (everything except the redirect scenario) skip
 * themselves when `SUPABASE_SERVICE_ROLE_KEY` is not present.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3010',
    trace: 'on-first-retry',
    // Phase 14 / H7: the proxy CSRF backstop rejects mutating /api/*
    // requests with no Origin header. Playwright's APIRequestContext
    // does not auto-send Origin (browsers do), so we set the same-origin
    // value here to mirror real-browser behaviour. Same-origin Origin is
    // a no-op for non-/api routes and for GETs.
    extraHTTPHeaders: {
      Origin: 'http://localhost:3010',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3010',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Opt-in E2E auth shim. The redirect test relies on the *absence*
      // of the `x-e2e-auth: 1` header so it still sees a null session
      // and gets redirected. See tests/e2e/editor.spec.ts header.
      E2E_TEST_AUTH_USER_ID:
        process.env.E2E_TEST_AUTH_USER_ID ?? '00000000-0000-4000-8000-000000000001',
      // Short auto-save debounce for the draft-restore scenario.
      E2E_AUTOSAVE_MS: process.env.E2E_AUTOSAVE_MS ?? '300',
      // Phase 9 anon-feed pages (`/`, `/latest`, `/tag/<slug>`, `/tags`,
      // `/search`) build their Supabase client at request time. Without
      // env vars the client factory throws and the page returns 500
      // instead of an empty state. CI doesn't ship real Supabase secrets,
      // so we inject placeholders here — client instantiation succeeds,
      // network requests fail, the page's existing try/catch around the
      // query degrades to the empty state. DB-dependent E2E tests gate
      // on E2E_TEST_AUTH_USER_ID and aren't affected.
      // `.invalid` is a reserved TLD that DNS will never resolve, so
      // fetches fail immediately rather than hanging on the supabase.co
      // wildcard.
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://supabase.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key',
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder-service-key',
      // Phase 12 admin E2E: forward the caller-supplied login list so the
      // `isAdmin(login)` check in `lib/auth.ts` recognises the shim user.
      // Leave unset in CI — admin tests skip when this is absent.
      ADMIN_GITHUB_LOGINS:
        process.env.ADMIN_GITHUB_LOGINS_FOR_E2E ?? '',
      // Phase 14 / L4: exercise the production-mode robots.txt branch
      // in CI so the e2e assertion can match the real prod content.
      // Without this, app/robots.ts returns the non-prod blanket
      // "Disallow: /" because VERCEL_ENV is unset on GitHub Actions.
      VERCEL_ENV: process.env.VERCEL_ENV ?? 'production',
    },
  },
})
