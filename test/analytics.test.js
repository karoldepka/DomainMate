import assert from 'node:assert/strict'
import test from 'node:test'
import { database } from '../server/utils/database.js'
import { getAnalyticsSummary, recordEvent } from '../server/utils/analytics.js'

test('recordEvent stores an allowed event, and getAnalyticsSummary reflects it', async () => {
  const clientId = 'analytics-test-client'
  database.prepare('DELETE FROM events WHERE client_id = ?').run(clientId)
  try {
    await recordEvent(clientId, 'search_run', { resultCount: 7, limited: false })
    const summary = await getAnalyticsSummary()
    const recorded = summary.recent.find((row) => row.client_id === clientId)
    assert.ok(recorded, 'the event should appear in recent events')
    assert.equal(recorded.name, 'search_run')
    assert.deepEqual(recorded.properties, { resultCount: 7, limited: false })
    assert.ok(summary.totals.some((row) => row.name === 'search_run' && row.count > 0))
  } finally {
    database.prepare('DELETE FROM events WHERE client_id = ?').run(clientId)
  }
})

test('recordEvent silently drops event names outside the allowlist', async () => {
  const clientId = 'analytics-test-client-disallowed'
  database.prepare('DELETE FROM events WHERE client_id = ?').run(clientId)
  await recordEvent(clientId, 'not_a_real_event', { anything: true })
  const stored = database.prepare('SELECT 1 FROM events WHERE client_id = ?').get(clientId)
  assert.equal(stored, undefined)
})

test('recordEvent normalizes non-object properties to an empty object', async () => {
  const clientId = 'analytics-test-client-props'
  database.prepare('DELETE FROM events WHERE client_id = ?').run(clientId)
  try {
    await recordEvent(clientId, 'pro_prompt_shown', 'not-an-object')
    const row = database.prepare('SELECT properties FROM events WHERE client_id = ?').get(clientId)
    assert.equal(row.properties, '{}')
  } finally {
    database.prepare('DELETE FROM events WHERE client_id = ?').run(clientId)
  }
})

test('recordEvent accepts optional request headers (for Vercel Analytics attribution) without throwing', async () => {
  const clientId = 'analytics-test-client-headers'
  database.prepare('DELETE FROM events WHERE client_id = ?').run(clientId)
  try {
    await recordEvent(clientId, 'search_run', { resultCount: 1 }, { 'user-agent': 'test-agent', 'referer': 'http://localhost/' })
    const stored = database.prepare('SELECT 1 FROM events WHERE client_id = ?').get(clientId)
    assert.ok(stored, 'the event should still be recorded when headers are provided')
  } finally {
    database.prepare('DELETE FROM events WHERE client_id = ?').run(clientId)
  }
})
