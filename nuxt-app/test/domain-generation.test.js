import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useDomainStore } from '../app/stores/domain.js'

/** Create a fresh store configured for a representative two-part search. */
function createStore() {
  setActivePinia(createPinia())
  const store = useDomainStore()
  store.brief = 'inno inter\ntech tek topic\n.dev .ai .com'
  store.maxLength = 24
  store.expandBrief()
  store.generate()
  return store
}

test('ranks clean compounds before edited variants', () => {
  setActivePinia(createPinia())
  const store = useDomainStore()
  store.brief = 'inno\ntech\n.dev'
  store.maxLength = 24
  store.expandBrief()
  store.generate()
  const names = [...new Set(store.results.map(({ brand }) => brand.toLowerCase()))]
  assert.ok(names.indexOf('innotech') >= 0)
  assert.ok(names.indexOf('innotek') >= 0)
  assert.ok(names.indexOf('innotech') < names.indexOf('innotek'))
})

test('honors generation limits and produces unique valid domains', () => {
  const store = createStore()
  assert.equal(store.results.length, 255)
  assert.equal(new Set(store.results.map(({ name }) => name)).size, 255)
  assert.ok(store.results.every(({ name }) => /^[a-z0-9]+\.(dev|ai|com)$/.test(name)))
  assert.ok(store.results.every(({ brand }) => Math.max(0, ...(brand.toLowerCase().match(/[^aeiouy]+/g) || []).map((part) => part.length)) <= 2))
})

test('generation order is deterministic', () => {
  const first = createStore().results.map(({ name }) => name)
  const second = createStore().results.map(({ name }) => name)
  assert.deepEqual(first, second)
})

test('the skip:first substitution drops a leading letter that survives the naming filters', () => {
  setActivePinia(createPinia())
  const withSkip = useDomainStore()
  withSkip.brief = 'idea\ntest\n.dev'
  withSkip.substitutions = ['skip:first']
  withSkip.strategies = ['direct']
  withSkip.expandBrief()
  withSkip.generate()
  assert.ok(withSkip.results.some(({ brand }) => brand.toLowerCase() === 'ideaest'))

  setActivePinia(createPinia())
  const withoutSkip = useDomainStore()
  withoutSkip.brief = 'idea\ntest\n.dev'
  withoutSkip.substitutions = []
  withoutSkip.strategies = ['direct']
  withoutSkip.expandBrief()
  withoutSkip.generate()
  assert.ok(!withoutSkip.results.some(({ brand }) => brand.toLowerCase() === 'ideaest'))
})

test('the reverse strategy allows brands that start with the second part', () => {
  setActivePinia(createPinia())
  const store = useDomainStore()
  store.brief = 'idea\ntest\n.dev'
  store.substitutions = []
  store.strategies = ['reverse']
  store.expandBrief()
  store.generate()
  assert.ok(store.results.length > 0)
  assert.ok(store.results.some(({ brand }) => brand.toLowerCase().startsWith('test')))
  assert.ok(store.results.every(({ name }) => name.endsWith('.dev')))
})

test('generation is not restricted to parts starting with I and T', () => {
  setActivePinia(createPinia())
  const store = useDomainStore()
  store.brief = 'cloud\nsync\n.dev'
  store.maxLength = 20
  store.substitutions = []
  store.strategies = ['direct']
  store.expandBrief()
  store.generate()
  assert.ok(store.results.some(({ brand }) => brand.toLowerCase() === 'cloudsync'))
})

test('a brief with only one line reuses it for both parts', () => {
  setActivePinia(createPinia())
  const store = useDomainStore()
  store.brief = 'acme\n.dev'
  store.maxLength = 20
  store.substitutions = []
  store.strategies = ['direct']
  store.expandBrief()
  store.generate()
  assert.ok(store.results.some(({ brand }) => brand.toLowerCase() === 'acmeacme'))
})

test('a leading dot marks a TLD on any line, not just the extensions line', () => {
  setActivePinia(createPinia())
  const store = useDomainStore()
  store.brief = 'inno .dev\ntech'
  store.expandBrief()
  store.generate()
  assert.ok(store.results.length > 0)
  assert.ok(store.results.every(({ name }) => name.endsWith('.dev')))
})

test('maxNames caps the base names before multiplying by the TLD count', () => {
  setActivePinia(createPinia())
  const store = useDomainStore()
  store.brief = 'inno inter\ntech tek topic\n.dev .ai .com'
  store.maxNames = 10
  store.expandBrief()
  store.generate()
  assert.ok(store.results.length > 0)
  assert.ok(store.results.length <= 30)
})

test('maxLength defaults to "innotek".length and excludes longer base names', () => {
  const store = createStore()
  assert.equal(store.maxLength, 24)

  setActivePinia(createPinia())
  const defaultStore = useDomainStore()
  assert.equal(defaultStore.maxLength, 'innotek'.length)
  defaultStore.brief = 'inno inter\ntech tek topic\n.dev .ai .com'
  defaultStore.expandBrief()
  defaultStore.generate()
  const names = [...new Set(defaultStore.results.map(({ brand }) => brand.toLowerCase()))]
  assert.ok(names.every((name) => name.length <= 7))
  assert.ok(names.includes('innotek'))
  assert.ok(!names.includes('intertech'))
})

test('every result is assigned one of the requested TLDs', () => {
  const store = createStore()
  const tlds = new Set(store.results.map(({ tld }) => tld))
  assert.deepEqual([...tlds].sort(), ['ai', 'com', 'dev'])
})
