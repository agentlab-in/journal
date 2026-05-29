import { test, expect } from '@playwright/test'

/**
 * Auth E2E tests — page-load checks only.
 * No real OAuth flows; both pages are static (no GitHub calls).
 */
test.describe('Auth pages', () => {
  test('/auth/signin responds 200 and shows "Continue with GitHub" button', async ({ page }) => {
    const response = await page.goto('/auth/signin')
    expect(response?.status()).toBe(200)

    const button = page.getByRole('button', { name: /Continue with GitHub/i })
    await expect(button).toBeVisible()
  })

  test('/auth/blocked?reason=no_public_repos responds 200 and shows repo copy', async ({
    page,
  }) => {
    const response = await page.goto('/auth/blocked?reason=no_public_repos')
    expect(response?.status()).toBe(200)

    // Spec: "Need at least 1 public repo" (or similar)
    await expect(page.getByText(/at least 1 public repo/i)).toBeVisible()
  })
})
