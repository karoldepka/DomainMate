import { test, expect } from '@playwright/test'

/** Seed the feature-flags localStorage key before the app's first script runs. */
async function seedFlags(page, overrides) {
  await page.addInitScript((value) => {
    localStorage.setItem('domainmate.featureFlags', JSON.stringify(value))
  }, overrides)
}

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

  test('unrated results are sorted shortest first by default', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.result-row').first()).toBeVisible()
    const hrefs = await page.locator('.domain-link').evaluateAll((links) => links.slice(0, 20).map((link) => link.getAttribute('href')))
    const lengths = hrefs.map((href) => new URL(href).hostname.length)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
  })

  test('rating a domain persists locally across a reload and sorts it first (favoritesSync off by default)', async ({ page }) => {
    await page.goto('/')
    const firstLink = page.locator('.domain-link').first()
    await expect(firstLink).toBeVisible()
    const href = await firstLink.getAttribute('href')
    const row = page.locator('.result-row').filter({ has: page.locator(`a[href="${href}"]`) })

    await row.locator('.star-button').nth(2).click()
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

  test('backend/AI features are hidden by default, showing a Free tier badge instead', async ({ page }) => {
    await page.goto('/')
    const firstRow = page.locator('.result-row').first()
    await expect(firstRow).toBeVisible()
    await expect(page.locator('.credit-button')).toHaveCount(0)
    await expect(page.locator('.free-tier-badge')).toHaveText('Free tier')
    await expect(firstRow.getByRole('button', { name: /Compare prices/ })).toHaveCount(0)
  })

  test('clicking the logo five times reveals the feature-flags panel, and toggling one persists', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.result-row').first()).toBeVisible()
    const logo = page.locator('.brand')
    for (let click = 0; click < 5; click += 1) await logo.click()
    const dialog = page.locator('.flags-dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Credits & payments').check()
    await dialog.getByRole('button', { name: 'Close feature flags' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.credit-button')).toBeVisible()

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('domainmate.featureFlags')))
    expect(stored.payments).toBe(true)
  })

  test('opens the payment dialog showing the not-configured state when payments are enabled', async ({ page }) => {
    await seedFlags(page, { payments: true })
    await page.goto('/')
    await page.locator('.credit-button').click()
    const dialog = page.locator('.payment-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Payments require STRIPE_SECRET_KEY.')).toBeVisible()
    await expect(dialog.getByText('BLIK')).toBeVisible()
  })

  test('opens the price comparison panel for a candidate when enabled', async ({ page }) => {
    await seedFlags(page, { priceComparison: true })
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

  test('rating syncs to the server when favoritesSync is enabled', async ({ page }) => {
    await seedFlags(page, { favoritesSync: true })
    await page.goto('/')
    const row = page.locator('.result-row').first()
    await expect(row).toBeVisible()
    const [syncResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/favorites/sync') && response.request().method() === 'POST'),
      row.locator('.star-button').nth(1).click(),
    ])
    expect(syncResponse.ok()).toBeTruthy()
  })
})
