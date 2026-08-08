import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeReturnPath } from '../server/utils/payments.js'

test('payment returns preserve safe workspace paths and queries', () => {
  assert.equal(normalizeReturnPath('/?brief=coffee&p1min=2#results'), '/?brief=coffee&p1min=2#results')
})

test('payment returns remove stale Stripe state', () => {
  assert.equal(normalizeReturnPath('/?brief=coffee&payment=cancelled&session_id=cs_test_old'), '/?brief=coffee')
})

test('payment returns reject absolute and protocol-relative URLs', () => {
  assert.equal(normalizeReturnPath('https://evil.example/steal'), '/')
  assert.equal(normalizeReturnPath('//evil.example/steal'), '/')
  assert.equal(normalizeReturnPath('/\\evil.example/steal'), '/')
})
