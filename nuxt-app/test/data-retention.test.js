import assert from 'node:assert/strict'
import test from 'node:test'
import { database } from '../server/utils/database.js'
import { sweepExpiredData } from '../server/utils/dataRetention.js'

test('sweepExpiredData deletes rows past the 12-month retention window and keeps recent ones', () => {
  const now = Date.now()
  const old = now - 366 * 24 * 60 * 60 * 1000
  const recent = now - 1000

  database.prepare('INSERT INTO favorites (client_id, domain, rating, updated_at) VALUES (?, ?, ?, ?)').run('retention-test-old', 'old-domain.test', 5, old)
  database.prepare('INSERT INTO favorites (client_id, domain, rating, updated_at) VALUES (?, ?, ?, ?)').run('retention-test-recent', 'recent-domain.test', 5, recent)
  database.prepare('INSERT INTO feedback (client_id, message, created_at) VALUES (?, ?, ?)').run('retention-test-old', 'old feedback', old)
  database.prepare('INSERT INTO feedback (client_id, message, created_at) VALUES (?, ?, ?)').run('retention-test-recent', 'recent feedback', recent)
  database.prepare('INSERT INTO client_errors (message, stack, url, user_agent, created_at) VALUES (?, ?, ?, ?, ?)').run('retention-test-old-error', null, null, null, old)
  database.prepare('INSERT INTO client_errors (message, stack, url, user_agent, created_at) VALUES (?, ?, ?, ?, ?)').run('retention-test-recent-error', null, null, null, recent)

  try {
    sweepExpiredData()

    assert.equal(database.prepare('SELECT 1 FROM favorites WHERE client_id = ?').get('retention-test-old'), undefined)
    assert.ok(database.prepare('SELECT 1 FROM favorites WHERE client_id = ?').get('retention-test-recent'))
    assert.equal(database.prepare('SELECT 1 FROM feedback WHERE client_id = ?').get('retention-test-old'), undefined)
    assert.ok(database.prepare('SELECT 1 FROM feedback WHERE client_id = ?').get('retention-test-recent'))
    assert.equal(database.prepare('SELECT 1 FROM client_errors WHERE message = ?').get('retention-test-old-error'), undefined)
    assert.ok(database.prepare('SELECT 1 FROM client_errors WHERE message = ?').get('retention-test-recent-error'))
  } finally {
    database.prepare('DELETE FROM favorites WHERE client_id IN (?, ?)').run('retention-test-old', 'retention-test-recent')
    database.prepare('DELETE FROM feedback WHERE client_id IN (?, ?)').run('retention-test-old', 'retention-test-recent')
    database.prepare('DELETE FROM client_errors WHERE message IN (?, ?)').run('retention-test-old-error', 'retention-test-recent-error')
  }
})
