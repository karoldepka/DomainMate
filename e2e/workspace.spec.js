import { test, expect } from '@playwright/test'

test.describe('naming workspace', () => {
  test('generates domain candidates on load with Available only checked by default', async ({ page }) => {
    await page.goto('/')
    const rows = page.locator('.result-row')
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBeGreaterThan(0)
    await expect(rows.first().locator('.status')).toHaveText(/Not checked/)
    await expect(page.getByLabel('Available only')).toBeChecked()
  })

  test('domain names link to https://<domain> in a new tab', async ({ page }) => {
    await page.goto('/')
    const link = page.locator('.domain-link').first()
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/^https:\/\/[a-z0-9-]+\.(dev|ai|com)\/?$/)
    await expect(link).toHaveAttribute('target', '_blank')
  })

  test('sorting by shortest orders unrated results by name length', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.result-row').first()).toBeVisible()
    await page.locator('.sort-select').selectOption('shortest')
    const hrefs = await page.locator('.domain-link').evaluateAll((links) => links.slice(0, 20).map((link) => link.getAttribute('href')))
    const lengths = hrefs.map((href) => new URL(href).hostname.length)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
  })

  test('rating a domain persists across a reload and sorts it first', async ({ page }) => {
    await page.goto('/')
    const firstLink = page.locator('.domain-link').first()
    await expect(firstLink).toBeVisible()
    const href = await firstLink.getAttribute('href')
    const row = page.locator('.result-row').filter({ has: page.locator(`a[href="${href}"]`) })

    const [syncResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/favorites/sync') && response.request().method() === 'POST'),
      row.locator('.star-button').nth(2).click(),
    ])
    expect(syncResponse.ok()).toBeTruthy()
    await expect(row.locator('.star-button').nth(0)).toHaveAttribute('aria-pressed', 'true')
    await expect(row.locator('.star-button').nth(2)).toHaveAttribute('aria-pressed', 'true')
    await expect(row.locator('.star-button').nth(3)).toHaveAttribute('aria-pressed', 'false')

    await page.reload()
    const reloadedRow = page.locator('.result-row').filter({ has: page.locator(`a[href="${href}"]`) })
    await expect(reloadedRow).toBeVisible()
    await expect(page.locator('.result-row').first().locator(`a[href="${href}"]`)).toHaveCount(1)
    await expect(reloadedRow.locator('.star-button').nth(2)).toHaveAttribute('aria-pressed', 'true')
  })

  test('language switcher translates the UI', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.result-row').first()).toBeVisible()
    await page.locator('.language-select select').selectOption('pl')
    await expect(page.locator('h1')).toHaveText('Znajdź nazwę, zanim zrobi to ktoś inny.')
    await expect(page.locator('.result-row').first().locator('.status')).toHaveText('Niesprawdzone')
  })

  test('opens the payment dialog showing the not-configured state', async ({ page }) => {
    await page.goto('/')
    await page.locator('.credit-button').click()
    const dialog = page.locator('.payment-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Payments require STRIPE_SECRET_KEY.')).toBeVisible()
    await expect(dialog.getByText('BLIK')).toBeVisible()
  })

  test('opens the price comparison panel for a candidate', async ({ page }) => {
    await page.route('**/api/registrars/compare*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        domain: 'example.dev',
        quotes: [
          { registrar: 'Porkbun', status: 'ok', currency: 'USD', registration: 10, renewal: 12, quoteKind: 'tld-list', url: 'https://porkbun.com/' },
          { registrar: 'GoDaddy', status: 'not-configured', url: 'https://godaddy.com/' },
        ],
      }),
    }))
    await page.goto('/')
    const firstRow = page.locator('.result-row').first()
    await expect(firstRow).toBeVisible()
    await firstRow.getByRole('button', { name: /Compare prices/ }).click()
    const panel = firstRow.locator('.price-comparison')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.quote-row').getByText('Porkbun')).toBeVisible()
  })
})
