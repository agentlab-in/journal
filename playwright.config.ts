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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3010',
    trace: 'on-first-retry',
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
    },
  },
})
