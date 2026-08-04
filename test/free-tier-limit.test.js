import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useDomainStore } from '../src/stores/domain.js'
import { flags } from '../src/featureFlags.js'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }

/** A brief that generates well over 50 results, to exercise the free-tier cap. */
function generateLargeBrief(store) {
  store.brief = 'inno inter\ntech tek topic\n.dev .ai .com'
  store.maxLength = 24
  store.expandBrief()
  store.generate()
}

test('free tier caps generated results to 50, pro tier does not', () => {
  setActivePinia(createPinia())
  flags.searchResults = false
  flags.aiSuggestions = false
  flags.favoritesSync = false
  const freeStore = useDomainStore()
  generateLargeBrief(freeStore)
  assert.equal(freeStore.results.length, 50)
  assert.equal(freeStore.resultsLimited, true)

  setActivePinia(createPinia())
  flags.searchResults = true
  flags.aiSuggestions = true
  flags.favoritesSync = true
  const proStore = useDomainStore()
  generateLargeBrief(proStore)
  assert.ok(proStore.results.length > 50)
  assert.equal(proStore.resultsLimited, false)
})

test('free tier does not flag results as limited when the natural result count is already under 50', () => {
  setActivePinia(createPinia())
  flags.searchResults = false
  flags.aiSuggestions = false
  flags.favoritesSync = false
  const store = useDomainStore()
  store.brief = 'inno\ntech\n.dev'
  store.maxLength = 24
  store.expandBrief()
  store.generate()
  assert.ok(store.results.length < 50)
  assert.equal(store.resultsLimited, false)
})
