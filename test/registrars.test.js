import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareRegistrarPrices,
  extractNameSiloPrice,
  getGoDaddyAuthorization,
  isPremiumInventory,
  parseDynadotPrice,
} from '../server/utils/registrars.js'

test('normalizes registrar-specific price representations', () => {
  assert.equal(getGoDaddyAuthorization({ GODADDY_PAT: 'pat-value' }), 'Bearer pat-value')
  assert.equal(getGoDaddyAuthorization({ GODADDY_API_KEY: 'legacy', GODADDY_API_SECRET: 'secret' }), '')

  assert.deepEqual(
    extractNameSiloPrice('sample.co.uk', {
      uk: { registration: '20.00', renew: '21.00', transfer: '22.00' },
      'co.uk': { registration: '9.50', renew: '13.00', transfer: '10.00' },
    }),
    { registration: 9.5, renewal: 13, transfer: 10 },
  )
  assert.deepEqual(
    parseDynadotPrice('Registration Price: 44.00 in USD and Renewal price: 52.00 in USD and Domain is not a Premium Domain'),
    { registration: 44, currency: 'USD', renewal: 52, premium: false },
  )
  assert.deepEqual(
    parseDynadotPrice('Registration Price: 1,499.00 in USD and Renewal price: 1,499.00 in USD and Domain is a Premium Domain'),
    { registration: 1499, currency: 'USD', renewal: 1499, premium: true },
  )
  assert.equal(isPremiumInventory('REGISTRY'), false)
  assert.equal(isPremiumInventory('REGISTRY_PREMIUM'), true)
  assert.equal(isPremiumInventory('PREMIUM'), true)
})

test('fetches and caches normalized quotes with provider-specific authentication', async () => {
  const originalFetch = globalThis.fetch
  const originalEnvironment = Object.fromEntries(
    ['GODADDY_PAT', 'GODADDY_API_KEY', 'GODADDY_API_SECRET', 'NAMESILO_API_KEY', 'DYNADOT_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_REGISTRAR_TOKEN']
      .map((key) => [key, process.env[key]]),
  )
  const requests = []

  Object.assign(process.env, {
    GODADDY_PAT: 'godaddy-pat',
    NAMESILO_API_KEY: 'namesilo-key',
    DYNADOT_API_KEY: 'dynadot-key',
    CLOUDFLARE_ACCOUNT_ID: 'cloudflare-account',
    CLOUDFLARE_REGISTRAR_TOKEN: 'cloudflare-token',
  })
  delete process.env.GODADDY_API_KEY
  delete process.env.GODADDY_API_SECRET

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input))
    requests.push({ url, options })

    if (url.hostname === 'api.porkbun.com') {
      return jsonResponse({ status: 'SUCCESS', pricing: { dev: { registration: '8.75', renewal: '12.87', transfer: '12.87' } } })
    }
    if (url.hostname === 'api.godaddy.com') {
      assert.equal(options.headers.Authorization, 'Bearer godaddy-pat')
      assert.equal(url.searchParams.get('optimizeFor'), 'ACCURACY')
      if (url.searchParams.get('domain') === 'rate-limit.dev') {
        return jsonResponse({}, 429, { 'retry-after': '45' })
      }
      return jsonResponse({
        available: true,
        inventory: 'REGISTRY_PREMIUM',
        prices: [{
          term: 'YEAR',
          period: 1,
          price: { currencyCode: 'USD', value: 1199 },
          renewalPrice: { currencyCode: 'USD', value: 2299 },
        }],
      })
    }
    if (url.hostname === 'www.namesilo.com') {
      assert.equal(url.searchParams.get('key'), 'namesilo-key')
      assert.equal(url.searchParams.get('retail_prices'), '1')
      return jsonResponse({
        reply: {
          code: 300,
          detail: 'success',
          dev: { registration: '9.50', renew: '13.00', transfer: '10.00' },
        },
      })
    }
    if (url.hostname === 'api.dynadot.com') {
      assert.equal(url.searchParams.get('key'), 'dynadot-key')
      const domain = url.searchParams.get('domain0')
      if (domain === 'invalid-key.dev') return jsonResponse({ Response: { ResponseCode: '-1', Error: 'invalid key' } })
      return jsonResponse({
        SearchResponse: {
          ResponseCode: '0',
          SearchResults: [{ DomainName: domain, Available: 'yes', Price: 'Registration Price: 10.50 in USD and Renewal price: 15.00 in USD and Domain is not a Premium Domain' }],
        },
      })
    }
    if (url.hostname === 'api.cloudflare.com') {
      assert.equal(options.headers.Authorization, 'Bearer cloudflare-token')
      const [domain] = JSON.parse(options.body).domains
      return jsonResponse({
        result: {
          domains: [{
            name: domain,
            registrable: true,
            tier: 'standard',
            pricing: { currency: 'USD', registration_cost: '10.11', renewal_cost: '10.11' },
          }],
        },
      })
    }
    throw new Error(`Unexpected registrar request: ${url}`)
  }

  try {
    await Promise.all([
      compareRegistrarPrices('first-list-cache.dev'),
      compareRegistrarPrices('second-list-cache.dev'),
    ])
    assert.equal(requests.filter(({ url }) => url.hostname === 'api.porkbun.com').length, 1)
    assert.equal(requests.filter(({ url }) => url.hostname === 'www.namesilo.com').length, 1)

    const quotes = await compareRegistrarPrices('sample.dev')
    assert.deepEqual(
      quotes.map(({ registrar, status, currency, registration, renewal, transfer }) => (
        { registrar, status, currency, registration, renewal, transfer }
      )),
      [
        { registrar: 'Porkbun', status: 'ok', currency: 'USD', registration: 8.75, renewal: 12.87, transfer: 12.87 },
        { registrar: 'GoDaddy', status: 'ok', currency: 'USD', registration: 11.99, renewal: 22.99, transfer: undefined },
        { registrar: 'Dynadot', status: 'ok', currency: 'USD', registration: 10.5, renewal: 15, transfer: undefined },
        { registrar: 'NameSilo', status: 'ok', currency: 'USD', registration: 9.5, renewal: 13, transfer: 10 },
        { registrar: 'Cloudflare', status: 'ok', currency: 'USD', registration: 10.11, renewal: 10.11, transfer: undefined },
      ],
    )
    assert.equal(quotes.find((quote) => quote.registrar === 'GoDaddy').premium, true)
    assert.equal(quotes.find((quote) => quote.registrar === 'Dynadot').premium, false)

    const requestCount = requests.length
    assert.strictEqual(await compareRegistrarPrices('sample.dev'), quotes)
    assert.equal(requests.length, requestCount)

    const beforeParallel = requests.length
    const [parallelA, parallelB] = await Promise.all([
      compareRegistrarPrices('parallel.dev'),
      compareRegistrarPrices('parallel.dev'),
    ])
    assert.strictEqual(parallelA, parallelB)
    assert.equal(requests.length - beforeParallel, 3)

    const rateLimited = await compareRegistrarPrices('rate-limit.dev')
    assert.deepEqual(
      rateLimited.find((quote) => quote.registrar === 'GoDaddy'),
      {
        registrar: 'GoDaddy',
        status: 'error',
        url: 'https://www.godaddy.com/domainsearch/find?domainToCheck=rate-limit.dev',
        message: 'Registrar rate limit exceeded. Retry after 45 seconds.',
        retryAfterSeconds: 45,
      },
    )
    // One provider erroring must not affect the others' results.
    assert.equal(rateLimited.length, 5)
    assert.deepEqual(
      rateLimited.filter((quote) => quote.registrar !== 'GoDaddy').map((quote) => quote.status),
      ['ok', 'ok', 'ok', 'ok'],
    )

    const invalidKey = await compareRegistrarPrices('invalid-key.dev')
    assert.deepEqual(
      invalidKey.find((quote) => quote.registrar === 'Dynadot'),
      { registrar: 'Dynadot', status: 'error', url: 'https://www.dynadot.com/domain/search.html?domain=invalid-key.dev', message: 'invalid key' },
    )
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('emits each registrar quote via onQuote as soon as it settles, in settlement order, not batched at the end', async () => {
  const originalFetch = globalThis.fetch
  const originalEnvironment = Object.fromEntries(
    ['GODADDY_PAT', 'NAMESILO_API_KEY', 'DYNADOT_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_REGISTRAR_TOKEN']
      .map((key) => [key, process.env[key]]),
  )
  Object.assign(process.env, {
    GODADDY_PAT: 'godaddy-pat',
    NAMESILO_API_KEY: 'namesilo-key',
    DYNADOT_API_KEY: 'dynadot-key',
    CLOUDFLARE_ACCOUNT_ID: 'cloudflare-account',
    CLOUDFLARE_REGISTRAR_TOKEN: 'cloudflare-token',
  })

  // Only stagger the live per-domain APIs. Porkbun/NameSilo share a long-TTL pricing-table
  // cache that an earlier test may have already warmed, making their own timing unpredictable
  // here — so this test proves progressiveness using the providers with no such cache.
  const delaysMs = { 'api.godaddy.com': 5, 'api.cloudflare.com': 10, 'api.dynadot.com': 50 }
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input))
    await new Promise((resolve) => setTimeout(resolve, delaysMs[url.hostname] ?? 0))
    if (url.hostname === 'api.porkbun.com') return jsonResponse({ status: 'SUCCESS', pricing: { dev: { registration: '8.75', renewal: '12.87', transfer: '12.87' } } })
    if (url.hostname === 'api.godaddy.com') {
      return jsonResponse({ available: true, inventory: 'REGISTRY', prices: [{ term: 'YEAR', period: 1, price: { currencyCode: 'USD', value: 1000 } }] })
    }
    if (url.hostname === 'www.namesilo.com') return jsonResponse({ reply: { code: 300, detail: 'success', dev: { registration: '9.50' } } })
    if (url.hostname === 'api.dynadot.com') {
      const domain = url.searchParams.get('domain0')
      return jsonResponse({
        SearchResponse: {
          ResponseCode: '0',
          SearchResults: [{ DomainName: domain, Available: 'yes', Price: 'Registration Price: 10.00 in USD and Renewal price: 15.00 in USD and Domain is not a Premium Domain' }],
        },
      })
    }
    if (url.hostname === 'api.cloudflare.com') {
      const [domain] = JSON.parse(options.body).domains
      return jsonResponse({ result: { domains: [{ name: domain, registrable: true, tier: 'standard', pricing: { currency: 'USD', registration_cost: '10.00', renewal_cost: '10.00' } }] } })
    }
    throw new Error(`Unexpected registrar request: ${url}`)
  }

  try {
    const start = Date.now()
    const emittedOrder = []
    const emittedElapsed = []
    const quotes = await compareRegistrarPrices('streaming-order.dev', (quote) => {
      emittedOrder.push(quote.registrar)
      emittedElapsed.push(Date.now() - start)
    })

    assert.equal(emittedOrder.length, 5)
    assert.deepEqual(new Set(emittedOrder), new Set(quotes.map((quote) => quote.registrar)))

    // Dynadot (50ms) is the slowest provider; the others must not wait for it.
    const dynadotIndex = emittedOrder.indexOf('Dynadot')
    assert.equal(dynadotIndex, emittedOrder.length - 1, `expected Dynadot to emit last, got order ${emittedOrder}`)
    assert.ok(emittedOrder.indexOf('GoDaddy') < dynadotIndex, 'GoDaddy (5ms) should emit before Dynadot (50ms)')
    assert.ok(emittedOrder.indexOf('Cloudflare') < dynadotIndex, 'Cloudflare (10ms) should emit before Dynadot (50ms)')
    assert.ok(
      emittedElapsed[dynadotIndex] - emittedElapsed[0] >= 30,
      `expected a meaningful time gap between the first and last emission, got elapsed offsets ${emittedElapsed}`,
    )
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

function jsonResponse(body, status = 200, headers = {}) {
  const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => normalizedHeaders.get(name.toLowerCase()) || null },
    json: async () => body,
  }
}
