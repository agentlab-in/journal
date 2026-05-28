import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  test('responds 200 and shows wordmark', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    // The wordmark "agentlab" appears in the hero heading
    await expect(page.locator('h1').filter({ hasText: 'agentlab' })).toBeVisible()
  })

  test('theme toggle changes data-theme attribute', async ({ page }) => {
    await page.goto('/')
    const toggle = page.getByTestId('theme-toggle')
    await expect(toggle).toBeVisible()

    // Get initial theme (may be light or dark depending on system)
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    )

    await toggle.click()

    const newTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    )

    // Theme must have changed
    expect(newTheme).not.toBe(initialTheme)
    expect(['light', 'dark']).toContain(newTheme)
  })
})
