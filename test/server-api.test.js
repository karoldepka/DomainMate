import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { app } from '../server/index.js'

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
