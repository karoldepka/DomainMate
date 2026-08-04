import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeFavoriteRows } from '../server/utils/favorites.js'

test('peer favorites are de-duplicated by domain using the newest timestamp', () => {
  const records = mergeFavoriteRows([
    [
      { domain: 'same.test', rating: 2, updated_at: 100 },
      { domain: 'supabase.test', rating: 4, updated_at: 200 }
    ],
    [
      { domain: 'same.test', rating: 5, updated_at: 300 },
      { domain: 'neon.test', rating: 3, updated_at: 150 }
    ]
  ])

  assert.deepEqual(records, [
    { domain: 'same.test', rating: 5, updatedAt: 300 },
    { domain: 'supabase.test', rating: 4, updatedAt: 200 },
    { domain: 'neon.test', rating: 3, updatedAt: 150 }
  ])
})
