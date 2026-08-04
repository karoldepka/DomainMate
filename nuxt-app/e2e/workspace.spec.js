import { test, expect } from '@playwright/test'

/** Seed the feature-flags localStorage key before the app's first script runs. */
async function seedFlags(page, overrides) {
  await page.addInitScript((value) => {
    localStorage.setItem('domainmate.featureFlags', JSON.stringify(value))
  }, overrides)
}

/** Encode registrar quotes as the newline-delimited stream the price panel expects. */
function ndjsonQuotes(quotes) {
  return quotes.map((quote) => `${JSON.stringify({ quote })}\n`).join('')
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

  test('part letter limits are accessible and persist as compact source parameters', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.result-row').first()).toBeVisible()
    const part1 = page.getByRole('group', { name: 'Name part 1' })
    const part2 = page.getByRole('group', { name: 'Name part 2' })
    const part1Min = part1.getByLabel('Minimum letters')
    const part1Max = part1.getByLabel('Maximum letters')
    const part2Min = part2.getByLabel('Minimum letters')
    const part2Max = part2.getByLabel('Maximum letters')

    await expect(part1Min).toHaveValue('1')
    await expect(part1Max).toHaveValue('24')
    await expect(part2Min).toHaveValue('1')
    await expect(part2Max).toHaveValue('24')

    await part1Min.fill('2')
    await part1Min.blur()
    await part1Max.fill('6')
    await part1Max.blur()
    await part2Min.fill('3')
    await part2Min.blur()
    await part2Max.fill('7')
    await part2Max.blur()

    const effectiveQuery = await page.locator('#effective-query').inputValue()
    expect(effectiveQuery).toContain('PART1_MIN_LETTERS: 2')
    expect(effectiveQuery).toContain('PART1_MAX_LETTERS: 6')
    expect(effectiveQuery).toContain('PART2_MIN_LETTERS: 3')
    expect(effectiveQuery).toContain('PART2_MAX_LETTERS: 7')
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams
      return [params.get('p1min'), params.get('p1max'), params.get('p2min'), params.get('p2max'), params.has('query')]
    }).toEqual(['2', '6', '3', '7', false])

    await page.reload()
    await expect(page.getByRole('group', { name: 'Name part 1' }).getByLabel('Minimum letters')).toHaveValue('2')
    await expect(page.getByRole('group', { name: 'Name part 2' }).getByLabel('Maximum letters')).toHaveValue('7')

    const editableQuery = page.locator('#effective-query')
    const editedQuery = (await editableQuery.inputValue())
      .replace('PART1_MIN_LETTERS: 2', 'PART1_MIN_LETTERS: 4')
      .replace('PART1_MAX_LETTERS: 6', 'PART1_MAX_LETTERS: 5')
      .replace('PART2_MIN_LETTERS: 3', 'PART2_MIN_LETTERS: 2')
      .replace('PART2_MAX_LETTERS: 7', 'PART2_MAX_LETTERS: 4')
    await editableQuery.fill(editedQuery)
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams
      return [params.get('p1min'), params.get('p1max'), params.get('p2min'), params.get('p2max')]
    }).toEqual(['4', '5', '2', '4'])

    await page.reload()
    await expect(page.getByRole('group', { name: 'Name part 1' }).getByLabel('Minimum letters')).toHaveValue('4')
    await expect(page.getByRole('group', { name: 'Name part 2' }).getByLabel('Maximum letters')).toHaveValue('4')
  })

  test('part letter controls fit the minimum supported viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/')
    await expect(page.locator('.result-row').first()).toBeVisible()
    await expect(page.getByRole('group', { name: 'Name part 1' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Name part 2' })).toBeVisible()
    const hasHorizontalOverflow = await page.locator('.part-letter-fields input').evaluateAll((inputs) => {
      const viewportWidth = document.documentElement.clientWidth
      return document.documentElement.scrollWidth > viewportWidth || inputs.some((input) => {
        const box = input.getBoundingClientRect()
        return box.left < 0 || box.right > viewportWidth
      })
    })
    expect(hasHorizontalOverflow).toBe(false)
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
    await page.getByLabel('Language').click()
    await page.getByRole('option', { name: 'Polski' }).click()
    await expect(page.locator('h1')).toHaveText('Znajdź atrakcyjną nazwę domeny.')
    await expect(page.locator('.result-row').first().locator('.status')).toHaveText('Niesprawdzone')
  })

  test('backend/AI extras are hidden by default while registrar comparison stays available', async ({ page }) => {
    await page.goto('/')
    const firstRow = page.locator('.result-row').first()
    await expect(firstRow).toBeVisible()
    await expect(page.locator('.credit-button')).toHaveCount(0)
    await expect(page.locator('.free-tier-badge')).toHaveText('Unlock pro tier')
    await expect(firstRow.getByRole('button', { name: /Compare prices/ })).toBeVisible()
  })

  test('clicking the logo five times reveals the feature-flags panel, and toggling one persists', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.result-row').first()).toBeVisible()
    const logo = page.locator('.brand')
    for (let click = 0; click < 5; click += 1) await logo.click()
    const dialog = page.getByRole('dialog')
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
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Payments require STRIPE_SECRET_KEY.')).toBeVisible()
    await expect(dialog.getByText('BLIK')).toBeVisible()
  })

  test('compares registrar prices and exposes providers that need credentials', async ({ page }) => {
    await page.route('**/api/registrars/compare*', (route) => route.fulfill({
      contentType: 'application/x-ndjson',
      body: ndjsonQuotes([
        { registrar: 'Porkbun', status: 'ok', currency: 'USD', registration: 5, renewal: 12, quoteKind: 'tld-list', url: 'https://porkbun.com/' },
        { registrar: 'GoDaddy', status: 'ok', currency: 'USD', registration: 12, renewal: 20, quoteKind: 'exact', premium: true, url: 'https://godaddy.com/' },
        { registrar: 'Cloudflare', status: 'ok', currency: 'USD', registration: 9, renewal: 9, quoteKind: 'exact', url: 'https://cloudflare.com/' },
        { registrar: 'NameSilo', status: 'not-configured', url: 'https://namesilo.com/' },
      ]),
    }))
    await page.goto('/')
    const firstRow = page.locator('.result-row').first()
    await expect(firstRow).toBeVisible()
    await firstRow.getByRole('button', { name: /Compare prices/ }).click()
    const panel = firstRow.locator('.price-comparison')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.quote-row').filter({ hasText: 'GoDaddy' })).toContainText('Live domain quote · Premium')
    await expect(panel.locator('.quote-row').filter({ hasText: 'Cloudflare' })).toContainText('Lowest')
    await expect(panel.locator('.quote-row').filter({ hasText: 'Porkbun' })).not.toContainText('Lowest')
    await expect(panel.locator('.quote-row').filter({ hasText: 'NameSilo' })).toContainText('API credentials required')
  })

  test('caches registrar prices in IndexedDB and only refetches on explicit refresh', async ({ page }) => {
    let requestCount = 0
    await page.route('**/api/registrars/compare*', (route) => {
      requestCount += 1
      route.fulfill({
        contentType: 'application/x-ndjson',
        body: ndjsonQuotes([{ registrar: 'Porkbun', status: 'ok', currency: 'USD', registration: requestCount, renewal: 12, quoteKind: 'tld-list', url: 'https://porkbun.com/' }]),
      })
    })
    await page.goto('/')
    const firstRow = page.locator('.result-row').first()
    await expect(firstRow).toBeVisible()
    const compareButton = firstRow.getByRole('button', { name: /Compare prices/ })
    const panel = firstRow.locator('.price-comparison')

    await compareButton.click()
    await expect(panel).toBeVisible()
    await expect(panel.locator('.quote-row')).toContainText('$1.00')
    expect(requestCount).toBe(1)

    await compareButton.click()
    await expect(panel).toBeHidden()
    await compareButton.click()
    await expect(panel).toBeVisible()
    await expect(panel.locator('.quote-row')).toContainText('$1.00')
    expect(requestCount).toBe(1)

    await panel.getByRole('button', { name: /Refresh/ }).click()
    await expect(panel.locator('.quote-row')).toContainText('$2.00')
    expect(requestCount).toBe(2)

    await page.reload()
    await expect(firstRow).toBeVisible()
    await compareButton.click()
    await expect(panel).toBeVisible()
    await expect(panel.locator('.quote-row')).toContainText('$2.00')
    expect(requestCount).toBe(2)
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
