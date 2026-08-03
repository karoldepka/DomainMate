import { test, expect } from '@playwright/test'

/** Read the first two candidate domains and their row locators before any network mocking is registered. */
async function firstTwoRows(page) {
  await page.goto('/')
  const rows = page.locator('.result-row')
  await expect(rows.first()).toBeVisible()
  const hrefs = await page.locator('.domain-link').evaluateAll((links) => links.slice(0, 2).map((link) => link.getAttribute('href')))
  const [availableHref, registeredHref] = hrefs
  return {
    availableDomain: new URL(availableHref).hostname,
    registeredDomain: new URL(registeredHref).hostname,
    availableRow: rows.filter({ has: page.locator(`a[href="${availableHref}"]`) }),
    registeredRow: rows.filter({ has: page.locator(`a[href="${registeredHref}"]`) }),
  }
}

test('checking domains updates their status, and Available only keeps just the available one', async ({ page }) => {
  const { availableDomain, registeredDomain, availableRow, registeredRow } = await firstTwoRows(page)

  // Neither candidate has a live HTTPS server in this scenario; the split happens at the DNS check.
  await page.route(`https://${availableDomain}/`, (route) => route.abort('connectionfailed'))
  await page.route(`https://${registeredDomain}/`, (route) => route.abort('connectionfailed'))

  await page.route('https://dns.google/**', (route) => {
    const name = new URL(route.request().url()).searchParams.get('name')
    if (name === registeredDomain) {
      return route.fulfill({ contentType: 'application/dns-json', body: JSON.stringify({ Status: 0, Answer: [{ type: 2, data: 'ns1.example.com' }] }) })
    }
    return route.fulfill({ contentType: 'application/dns-json', body: JSON.stringify({ Status: 3, Answer: [] }) })
  })
  // Only the available candidate reaches RDAP; the registered one short-circuits on DNS delegation.
  await page.route('https://rdap.org/**', (route) => route.fulfill({
    status: 404,
    contentType: 'application/rdap+json',
    body: '{}',
  }))

  await availableRow.getByRole('button', { name: `Check ${availableDomain}` }).click()
  await registeredRow.getByRole('button', { name: `Check ${registeredDomain}` }).click()

  await expect(availableRow.locator('.status.available')).toBeVisible({ timeout: 10000 })
  await expect(registeredRow).toHaveCount(0, { timeout: 10000 })

  await page.getByLabel('Available only').uncheck()
  await expect(registeredRow.locator('.status.registered')).toBeVisible()
})

test('a live HTTPS response marks a domain registered without reaching DNS or RDAP', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('.result-row')
  await expect(rows.first()).toBeVisible()
  const href = await page.locator('.domain-link').first().getAttribute('href')
  const domain = new URL(href).hostname
  const row = rows.filter({ has: page.locator(`a[href="${href}"]`) })

  let dnsOrRdapCalled = false
  await page.route(`https://${domain}/`, (route) => route.fulfill({ status: 200, body: '' }))
  await page.route('https://dns.google/**', (route) => { dnsOrRdapCalled = true; return route.abort() })
  await page.route('https://rdap.org/**', (route) => { dnsOrRdapCalled = true; return route.abort() })

  await page.getByLabel('Available only').uncheck()
  await row.getByRole('button', { name: `Check ${domain}` }).click()
  await expect(row.locator('.status.registered')).toBeVisible({ timeout: 10000 })
  expect(dnsOrRdapCalled).toBe(false)
})
