import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useDomainStore } from '../app/stores/domain.js'
import { flags } from '../app/featureFlags.js'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }

/** A brief that generates 255 results (well over every capped tier), to exercise the caps. */
function generateLargeBrief(store) {
  store.brief = 'inno inter\ntech tek topic\n.dev .ai .com'
  store.maxLength = 24
  store.expandBrief()
  store.generate()
}

/** Reset every tier-related flag to off before each scenario. */
function resetTierFlags() {
  flags.searchResults = false
  flags.aiSuggestions = false
  flags.favoritesSync = false
  flags.proTier = false
  flags.unlimitedPro = false
}

test('free tier caps generated results to 50', () => {
  setActivePinia(createPinia())
  resetTierFlags()
  const store = useDomainStore()
  generateLargeBrief(store)
  assert.equal(store.results.length, 50)
  assert.equal(store.resultsLimited, true)
})

test('basic tier (feedback-unlocked) caps generated results to 200', () => {
  setActivePinia(createPinia())
  resetTierFlags()
  flags.searchResults = true
  flags.aiSuggestions = true
  flags.favoritesSync = true
  const store = useDomainStore()
  generateLargeBrief(store)
  assert.equal(store.results.length, 200)
  assert.equal(store.resultsLimited, true)
})

test('pro tier (paid) caps generated results to 500, so a 255-result brief is not limited', () => {
  setActivePinia(createPinia())
  resetTierFlags()
  flags.proTier = true
  const store = useDomainStore()
  generateLargeBrief(store)
  assert.equal(store.results.length, 255)
  assert.equal(store.resultsLimited, false)
})

test('unlimited tier (paid) never caps generated results', () => {
  setActivePinia(createPinia())
  resetTierFlags()
  flags.unlimitedPro = true
  const store = useDomainStore()
  generateLargeBrief(store)
  assert.equal(store.results.length, 255)
  assert.equal(store.resultsLimited, false)
})

test('free tier does not flag results as limited when the natural result count is already under 50', () => {
  setActivePinia(createPinia())
  resetTierFlags()
  const store = useDomainStore()
  store.brief = 'inno\ntech\n.dev'
  store.maxLength = 24
  store.expandBrief()
  store.generate()
  assert.ok(store.results.length < 50)
  assert.equal(store.resultsLimited, false)
})
