import assert from 'node:assert/strict'
import test from 'node:test'
import { firstSuccessful } from '../server/utils/database.js'

test('peer reads return the first successful response', async () => {
  const slow = new Promise(resolve => setTimeout(() => resolve('slow'), 50))
  const fast = new Promise(resolve => setTimeout(() => resolve('fast'), 5))
  assert.equal(await firstSuccessful([slow, fast]), 'fast')
})

test('peer reads ignore a fast failure when another peer succeeds', async () => {
  const failed = Promise.reject(new Error('unavailable'))
  const healthy = new Promise(resolve => setTimeout(() => resolve('healthy'), 5))
  assert.equal(await firstSuccessful([failed, healthy]), 'healthy')
})
