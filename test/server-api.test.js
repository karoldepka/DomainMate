import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { after, before } from 'node:test'
import { app } from '../server/index.js'

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

let baseUrl
let server

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

for (const path of ['/api/check', '/api/search', '/api/domain-check']) {
  test(`GET ${path} rejects an invalid domain`, async () => {
    const response = await fetch(`${baseUrl}${path}?domain=${encodeURIComponent('not a domain')}`)
    assert.equal(response.status, 400)
    const data = await response.json()
    assert.match(data.error, /valid domain/i)
  })
}

test('GET /api/registrars/compare rejects an invalid domain', async () => {
  const response = await fetch(`${baseUrl}/api/registrars/compare?domain=nope`)
  assert.equal(response.status, 400)
})

test('GET /api/registrars/compare streams one NDJSON line per registrar as it settles, not buffered until the end', async () => {
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

  const delaysMs = { 'api.cloudflare.com': 5, 'api.dynadot.com': 60 }
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input))
    await new Promise((resolve) => setTimeout(resolve, delaysMs[url.hostname] ?? 0))
    if (url.hostname === 'api.porkbun.com') return new Response(JSON.stringify({ status: 'SUCCESS', pricing: { dev: { registration: '8.75', renewal: '12.87', transfer: '12.87' } } }))
    if (url.hostname === 'api.godaddy.com') {
      return new Response(JSON.stringify({ available: true, inventory: 'REGISTRY', prices: [{ term: 'YEAR', period: 1, price: { currencyCode: 'USD', value: 1000 } }] }))
    }
    if (url.hostname === 'www.namesilo.com') return new Response(JSON.stringify({ reply: { code: 300, detail: 'success', dev: { registration: '9.50' } } }))
    if (url.hostname === 'api.dynadot.com') {
      const domain = url.searchParams.get('domain0')
      return new Response(JSON.stringify({
        SearchResponse: {
          ResponseCode: '0',
          SearchResults: [{ DomainName: domain, Available: 'yes', Price: 'Registration Price: 10.00 in USD and Renewal price: 15.00 in USD and Domain is not a Premium Domain' }],
        },
      }))
    }
    if (url.hostname === 'api.cloudflare.com') {
      const [domain] = JSON.parse(options.body).domains
      return new Response(JSON.stringify({ result: { domains: [{ name: domain, registrable: true, tier: 'standard', pricing: { currency: 'USD', registration_cost: '10.00', renewal_cost: '10.00' } }] } }))
    }
    return originalFetch(input, options)
  }

  try {
    const start = Date.now()
    const response = await fetch(`${baseUrl}/api/registrars/compare?domain=http-stream.dev`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', /application\/x-ndjson/)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const registrars = []
    const arrivals = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        if (!line.trim()) continue
        registrars.push(JSON.parse(line).quote.registrar)
        arrivals.push(Date.now() - start)
      }
    }

    assert.deepEqual(new Set(registrars), new Set(['Porkbun', 'GoDaddy', 'Dynadot', 'NameSilo', 'Cloudflare']))
    // Cloudflare (5ms) must arrive well before Dynadot (60ms) — proving the response is
    // genuinely flushed line-by-line over the wire, not assembled and sent all at once.
    const cloudflareArrival = arrivals[registrars.indexOf('Cloudflare')]
    const dynadotArrival = arrivals[registrars.indexOf('Dynadot')]
    assert.ok(dynadotArrival - cloudflareArrival >= 30, `expected Cloudflare well before Dynadot, got arrivals ${arrivals} for ${registrars}`)
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('GET /api/suggest rejects a word outside the allowed shape', async () => {
  const response = await fetch(`${baseUrl}/api/suggest?word=${encodeURIComponent('123 not a word!')}`)
  assert.equal(response.status, 400)
})

test('GET /api/suggest returns no words when the AI provider is not configured', async () => {
  const response = await fetch(`${baseUrl}/api/suggest?word=inno`)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.deepEqual(data.words, [])
})

test('GET /api/health reports search and AI configuration status', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.ok, true)
  assert.equal(typeof data.search.selected, 'string')
  assert.ok(Array.isArray(data.search.configured))
  assert.equal(typeof data.ai, 'boolean')
})

test('GET /api/payments/packs lists credit packs without exposing Stripe configuration', async () => {
  const response = await fetch(`${baseUrl}/api/payments/packs`)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.currency, 'PLN')
  assert.ok(data.packs.length >= 1)
  assert.ok(data.packs.every((pack) => pack.id && pack.credits > 0 && pack.amount > 0))
})

test('POST /api/payments/checkout fails cleanly when Stripe is not configured', async () => {
  const response = await fetch(`${baseUrl}/api/payments/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ packId: 'starter' }),
  })
  assert.equal(response.status, 503)
  const data = await response.json()
  assert.match(data.error, /not configured/i)
})

test('POST /api/payments/checkout rejects requests without a recognized origin', async () => {
  const response = await fetch(`${baseUrl}/api/payments/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: 'starter' }),
  })
  assert.equal(response.status, 400)
  const data = await response.json()
  assert.match(data.error, /APP_URL/)
})

test('POST /api/favorites/sync rejects a malformed client id', async () => {
  const response = await fetch(`${baseUrl}/api/favorites/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'not-a-uuid', records: [] }),
  })
  assert.equal(response.status, 400)
})

test('POST /api/favorites/sync rejects a rating outside 0-5', async () => {
  const response = await fetch(`${baseUrl}/api/favorites/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: '11111111-1111-1111-1111-111111111111',
      records: [{ domain: 'example.dev', rating: 6, updatedAt: Date.now() }],
    }),
  })
  assert.equal(response.status, 400)
})

test('POST /api/favorites/sync accepts a valid record and echoes it back', async () => {
  const clientId = '22222222-2222-2222-2222-222222222222'
  const response = await fetch(`${baseUrl}/api/favorites/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, records: [{ domain: 'example.dev', rating: 4, updatedAt: Date.now() }] }),
  })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.records.length, 1)
  assert.equal(data.records[0].domain, 'example.dev')
  assert.equal(data.records[0].rating, 4)
})

test('POST /api/feedback rejects a malformed client id', async () => {
  const response = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'not-a-uuid', message: 'hello' }),
  })
  assert.equal(response.status, 400)
})

test('POST /api/feedback rejects an empty message', async () => {
  const response = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: '33333333-3333-3333-3333-333333333333', message: '  ' }),
  })
  assert.equal(response.status, 400)
})

test('POST /api/feedback unlocks pro status for that client, and GET /api/feedback/status reports it', async () => {
  const clientId = '44444444-4444-4444-4444-444444444444'
  const submitResponse = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, message: 'More registrars please!' }),
  })
  assert.equal(submitResponse.status, 200)

  const statusResponse = await fetch(`${baseUrl}/api/feedback/status?clientId=${clientId}`)
  assert.equal(statusResponse.status, 200)
  const statusData = await statusResponse.json()
  assert.equal(statusData.unlocked, true)

  const otherStatusResponse = await fetch(`${baseUrl}/api/feedback/status?clientId=55555555-5555-5555-5555-555555555555`)
  const otherStatusData = await otherStatusResponse.json()
  assert.equal(otherStatusData.unlocked, false)
})

test('POST /api/client-errors accepts a report and rejects a missing message', async () => {
  const okResponse = await fetch(`${baseUrl}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'TypeError: boom', stack: 'at x.js:1:1', url: 'http://localhost/', userAgent: 'test-agent' }),
  })
  assert.equal(okResponse.status, 200)

  const badResponse = await fetch(`${baseUrl}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '' }),
  })
  assert.equal(badResponse.status, 400)
})

test('malformed JSON bodies get a clean JSON error, not an HTML stack trace', async () => {
  const response = await fetch(`${baseUrl}/api/favorites/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not valid json',
  })
  assert.equal(response.status, 400)
  assert.match(response.headers.get('content-type') || '', /application\/json/)
  const data = await response.json()
  assert.equal(typeof data.error, 'string')
  assert.doesNotMatch(data.error, /node_modules|SyntaxError|at [A-Za-z]/)
})

test('responses carry baseline security headers and hide the framework', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.equal(response.headers.get('x-powered-by'), null)
})

test('serves the built SPA for unknown routes, never raw unbundled source', { skip: !existsSync(distDir) && 'run `pnpm build` first' }, async () => {
  const response = await fetch(`${baseUrl}/some/deep/link`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /text\/html/)
  const html = await response.text()
  assert.doesNotMatch(html, /src="\/src\/main\.js"/)
  assert.match(html, /<script type="module"[^>]*src="\/assets\//)
})

test('API routes are not shadowed by the SPA fallback', { skip: !existsSync(distDir) && 'run `pnpm build` first' }, async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  const data = await response.json()
  assert.equal(data.ok, true)
})
