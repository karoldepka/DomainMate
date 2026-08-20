import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useDomainStore } from '../app/stores/domain.js'
import { flags } from '../app/featureFlags.js'

// This file tests the generation algorithm itself, not tier gating — unlock the unlimited
// tier so no domain-count cap (tested separately) truncates these assertions. featureFlags.js
// persists flag writes to localStorage, which doesn't exist in this Node test environment.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }
flags.unlimitedPro = true

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

/**
 * Generate one controlled root pair so tests can assert each strategy's
 * contribution lengths independently of brief expansion and substitutions.
 * @param {{part1?: string, part2?: string, strategy: string, part1Range: [string|number, string|number], part2Range: [string|number, string|number], maxConsonants?: number}} options
 */
function generateWithPartLimits({ part1 = 'alpha', part2 = 'beta', strategy, part1Range, part2Range, maxConsonants = 6 }) {
  setActivePinia(createPinia())
  const store = useDomainStore()
  store.effectiveQuery = [
    `PART1: ${part1}`,
    `PART2: ${part2}`,
    `PART1_MIN_LETTERS: ${part1Range[0]}`,
    `PART1_MAX_LETTERS: ${part1Range[1]}`,
    `PART2_MIN_LETTERS: ${part2Range[0]}`,
    `PART2_MAX_LETTERS: ${part2Range[1]}`,
    'TLD: .dev',
    'CONTEXT:',
    'SUBSTITUTIONS: skip:never',
    `STRATEGIES: ${strategy}`,
    'MAX_SYLLABLES: 8',
    `MAX_CONSONANTS: ${maxConsonants}`,
    'MAX_LENGTH: 24',
    'MAX_NAMES: 150',
  ].join('\n')
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

test('preserves dots in common second-level domain suffixes', () => {
  setActivePinia(createPinia())
  const store = useDomainStore()
  store.brief = 'inno\ntech\n.co.uk'
  store.maxLength = 24
  store.expandBrief()
  store.generate()
  assert.ok(store.results.length > 0)
  assert.ok(store.results.every(({ name, tld }) => name.endsWith('.co.uk') && tld === 'co.uk'))
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

test('effective queries without part limits retain the 1-to-24 default behavior', () => {
  const explicit = createStore().results.map(({ name }) => name)

  setActivePinia(createPinia())
  const legacy = useDomainStore()
  legacy.brief = 'inno inter\ntech tek topic\n.dev .ai .com'
  legacy.maxLength = 24
  legacy.expandBrief()
  legacy.effectiveQuery = legacy.effectiveQuery.split('\n').filter((line) => !/^PART[12]_(?:MIN|MAX)_LETTERS:/.test(line)).join('\n')
  legacy.generate()

  assert.equal(legacy.part1MinLetters, 1)
  assert.equal(legacy.part1MaxLetters, 24)
  assert.equal(legacy.part2MinLetters, 1)
  assert.equal(legacy.part2MaxLetters, 24)
  assert.deepEqual(legacy.results.map(({ name }) => name), explicit)
})

test("part limits use each strategy's actual source-part contribution before deduplication", () => {
  const cases = [
    { strategy: 'direct', part1Range: [4, 4], part2Range: [4, 4], expected: ['alphbeta'] },
    { strategy: 'blend', part1Range: [3, 3], part2Range: [2, 2], expected: ['alpbe'] },
    { strategy: 'overlap', part1Range: [5, 5], part2Range: [4, 4], expected: ['alphabeta'] },
    { strategy: 'compact', part1Range: [1, 1], part2Range: [4, 4], expected: ['abeta'] },
    { strategy: 'suffix', part1Range: [4, 4], part2Range: [3, 3], expected: ['alphbetlabs', 'alphbetflow', 'alphbetbase', 'alphbetforge'] },
    { strategy: 'reverse', part1Range: [5, 5], part2Range: [4, 4], expected: ['betalpha', 'betaalpha'] },
    { part1: 'axis', part2: 'brand', strategy: 'bridge', part1Range: [4, 4], part2Range: [5, 5], maxConsonants: 2, expected: ['axisibrand'] },
  ]

  for (const { expected, ...options } of cases) {
    const store = generateWithPartLimits(options)
    assert.deepEqual(store.results.map(({ brand }) => brand), expected, `${options.strategy} contribution lengths differ`)
  }
})

test('part ranges generate every permitted source-prefix length', () => {
  const store = generateWithPartLimits({
    strategy: 'direct',
    part1Range: [2, 3],
    part2Range: [2, 3],
  })

  assert.deepEqual(new Set(store.results.map(({ brand }) => brand)), new Set(['albe', 'albet', 'alpbe', 'alpbet']))
})

test('part limits clamp malformed values and normalize reversed ranges', () => {
  const store = generateWithPartLimits({
    strategy: 'direct',
    part1Range: [99, 4],
    part2Range: ['invalid', 0],
  })

  assert.equal(store.part1MinLetters, 4)
  assert.equal(store.part1MaxLetters, 24)
  assert.equal(store.part2MinLetters, 1)
  assert.equal(store.part2MaxLetters, 1)
})
