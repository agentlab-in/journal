import { test, expect } from '@playwright/test'

test.describe('Coming Soon waitlist form', () => {
  test('renders the email input and join button', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('textbox', { name: /email address/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^join$/i })).toBeVisible()
    await expect(page.getByText(/coming soon/i)).toBeVisible()
  })

  test('shows client-side validation error for malformed email', async ({ page }) => {
    await page.goto('/')
    const input = page.getByRole('textbox', { name: /email address/i })
    await input.fill('not-an-email')
    await page.getByRole('button', { name: /^join$/i }).click()
    await expect(page.getByRole('status')).toContainText(/valid email/i)
  })

  test('shows success state when API returns 200', async ({ page }) => {
    await page.route('**/api/waitlist', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.goto('/')
    await page.getByRole('textbox', { name: /email address/i }).fill('test@agentlab.in')
    await page.getByRole('button', { name: /^join$/i }).click()
    await expect(page.getByRole('status')).toContainText(/on the list/i)
    await expect(page.getByRole('button', { name: /joined/i })).toBeDisabled()
  })

  test('shows error state when API returns 503', async ({ page }) => {
    await page.route('**/api/waitlist', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Waitlist temporarily unavailable.' }),
      })
    })
    await page.goto('/')
    await page.getByRole('textbox', { name: /email address/i }).fill('test@agentlab.in')
    await page.getByRole('button', { name: /^join$/i }).click()
    await expect(page.getByRole('status')).toContainText(/temporarily unavailable/i)
  })
})
