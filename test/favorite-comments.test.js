import assert from 'node:assert/strict'
import test from 'node:test'
import { syncFavorites } from '../server/utils/favorites.js'
import { normalizeFavorite } from '../server/utils/validation.js'

test('favorite comments are validated and persisted with their domain', async () => {
  const clientId = 'comments-test-client'
  const record = normalizeFavorite({
    domain: 'commented.test',
    rating: 4,
    comment: 'Strong candidate',
    updatedAt: Date.now()
  })

  assert.equal(record.comment, 'Strong candidate')
  const records = await syncFavorites(clientId, [record])
  assert.equal(records[0].comment, 'Strong candidate')
})

test('favorite comments are capped at 2000 characters', () => {
  const record = normalizeFavorite({ domain: 'bounded.test', rating: 0, comment: 'x'.repeat(2500), updatedAt: Date.now() })
  assert.equal(record.comment.length, 2000)
})
