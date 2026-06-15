import { test, expect } from '@playwright/test'

test.describe('Coming Soon page', () => {
  test('shows launching-soon copy', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/launching soon/i)).toBeVisible()
  })

  test('no waitlist form is rendered', async ({ page }) => {
    await page.goto('/')
    // The waitlist form was removed ahead of launch; guard against it returning.
    await expect(page.getByRole('textbox', { name: /email address/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^join$/i })).toHaveCount(0)
  })
})
