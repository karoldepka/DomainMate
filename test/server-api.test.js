import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import test, { after, before } from 'node:test'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const entryFile = join(rootDir, '.output', 'server', 'index.mjs')

let baseUrl
let child

before(async () => {
  if (!existsSync(entryFile)) throw new Error('Run `pnpm build` before the test suite.')
  // Strip real registrar credentials so /api/registrars/compare stays deterministic and fast
  // (all providers resolve as "not configured" instantly) instead of hitting live upstream APIs.
  const { GODADDY_PAT, NAMESILO_API_KEY, DYNADOT_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_REGISTRAR_TOKEN, NAMECOM_USERNAME, NAMECOM_API_TOKEN, ...testEnv } = process.env
  child = spawn(process.execPath, [entryFile], { cwd: rootDir, env: { ...testEnv, PORT: '0' } })
  baseUrl = await new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk) => {
      output += chunk.toString()
      const match = output.match(/Listening on http:\/\/\S*:(\d+)/)
      if (match) {
        child.stdout.off('data', onData)
        resolve(`http://localhost:${match[1]}`)
      }
    }
    child.stdout.on('data', onData)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Server exited early with code ${code}`)))
  })
})

after(async () => {
  child.kill()
  await new Promise((resolve) => child.once('exit', resolve))
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

test('GET /api/payments/packs lists pro tiers without exposing Stripe configuration', async () => {
  const response = await fetch(`${baseUrl}/api/payments/packs`)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.currency, 'USD')
  assert.ok(data.tiers.length >= 1)
  assert.ok(data.tiers.every((tier) => tier.id && tier.amount > 0))
})

test('POST /api/payments/checkout fails cleanly when Stripe is not configured', async () => {
  const response = await fetch(`${baseUrl}/api/payments/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ tierId: 'pro', clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
  })
  assert.equal(response.status, 503)
  const data = await response.json()
  assert.match(data.error, /not configured/i)
})

test('POST /api/payments/checkout rejects requests without a recognized origin', async () => {
  const response = await fetch(`${baseUrl}/api/payments/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tierId: 'pro', clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
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

test('POST /api/feedback unlocks basic status for that client, and GET /api/feedback/status reports it', async () => {
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

test('GET /api/payments/status reports null tier for a client with no purchases', async () => {
  const response = await fetch(`${baseUrl}/api/payments/status?clientId=66666666-6666-6666-6666-666666666666`)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.tier, null)
})

test('GET /api/payments/status rejects a malformed client id', async () => {
  const response = await fetch(`${baseUrl}/api/payments/status?clientId=not-a-uuid`)
  assert.equal(response.status, 400)
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

test('POST /api/analytics/track accepts a valid event and rejects a missing name', async () => {
  const okResponse = await fetch(`${baseUrl}/api/analytics/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'analytics-http-test', name: 'search_run', properties: { resultCount: 3 } }),
  })
  assert.equal(okResponse.status, 200)
  const okData = await okResponse.json()
  assert.equal(okData.ok, true)

  const badResponse = await fetch(`${baseUrl}/api/analytics/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'analytics-http-test' }),
  })
  assert.equal(badResponse.status, 400)
})

test('GET /api/admin/analytics rejects a request without the correct admin token', async () => {
  const response = await fetch(`${baseUrl}/api/admin/analytics`, { headers: { 'x-admin-token': 'definitely-not-the-real-token' } })
  assert.ok(!response.ok)
  const data = await response.json()
  assert.equal(data.totals, undefined)
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

test('serves the prerendered app shell for the home page', async () => {
  const response = await fetch(`${baseUrl}/`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /text\/html/)
  const html = await response.text()
  assert.doesNotMatch(html, /src="\/app\/main\.js"/)
  assert.match(html, /class="app-shell"/)
})
