import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { flags, proUnlocked } from '../featureFlags.js'
import { readCachedLookup, writeCachedLookup } from '../services/domainCache.js'
import { track } from '../services/analytics.js'

/** @typedef {'idle'|'checking'|'done'|'error'} CheckStatus */
/** @typedef {'available'|'registered'|'unknown'|null} Availability */
/** @typedef {{provider?: string, status: string, query?: string, totalResults?: number, countKind?: 'exact'|'estimated'|'returned'}} SearchResult */
/** @typedef {{id: string, name: string, brand: string, tld: string, status: CheckStatus, availability: Availability, availabilityNote?: string, search: SearchResult|null, copied?: boolean}} DomainCandidate */
/** @typedef {{minLetters: number, maxLetters: number}} PartLetterLimits */
/** @typedef {{part1Roots: string[], part2Roots: string[], part1Limits: PartLetterLimits, part2Limits: PartLetterLimits, tlds: string[], context: string, substitutions: string[], strategies: string[], maxSyllables: number, maxConsonants: number, maxLength: number, maxNames: number}} EffectiveQuery */

/** @param {string} value */
const clean = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
/** @param {string[]} items */
const unique = (items) => [...new Set(items.filter(Boolean))]
const defaultBrief = 'inno Inter\ntech tek\n.dev .ai .com'
const defaultSubstitutions = ['ch:k', 'ch:ck', 'ch:kk', 'cs:x', 'c:k', 'c:ck', 'c:kk', 'ph:f', 'x:ks', 's:z', 'double:n', 'double:t', 'double:k']
const defaultStrategies = ['direct', 'blend', 'overlap', 'bridge', 'compact', 'suffix']
const defaultPartMinLetters = 1
const defaultPartMaxLetters = 24
const freeTierResultLimit = 50

export const useDomainStore = defineStore('domains', () => {
  const brief = ref(defaultBrief)
  const effectiveQuery = ref('')
  const keywords = ref('innovation technology')
  const maxSyllables = ref(3)
  const maxConsonants = ref(2)
  const maxLength = ref('innotek'.length)
  const part1MinLetters = ref(defaultPartMinLetters)
  const part1MaxLetters = ref(defaultPartMaxLetters)
  const part2MinLetters = ref(defaultPartMinLetters)
  const part2MaxLetters = ref(defaultPartMaxLetters)
  const substitutions = ref([...defaultSubstitutions])
  const useThesaurus = ref(true)
  const enriching = ref(false)
  const strategies = ref([...defaultStrategies])
  const maxNames = ref(150)
  /** @type {import('vue').Ref<DomainCandidate[]>} */
  const results = ref([])
  const resultsLimited = ref(false)
  const running = ref(false)
  let stopRequested = false
  /** Synonym roots from the last thesaurus enrichment, kept separate from PART1/PART2 so they widen generation without rewriting the user's text. */
  const thesaurusAdditions = ref({ part1: [], part2: [] })
  const checkedCount = computed(() => results.value.filter((item) => item.status !== 'idle').length)
  const availableCount = computed(() => results.value.filter((item) => item.availability === 'available').length)

  /** Expand a terse naming brief into an explicit query that remains user-editable. */
  function expandBrief() {
    const { part1Roots, part2Roots, tlds, words } = parseBrief(brief.value)

    effectiveQuery.value = [
      `PART1: ${expandRoots(part1Roots).join(' ')}`,
      `PART2: ${expandRoots(part2Roots).join(' ')}`,
      `PART1_MIN_LETTERS: ${part1MinLetters.value}`,
      `PART1_MAX_LETTERS: ${part1MaxLetters.value}`,
      `PART2_MIN_LETTERS: ${part2MinLetters.value}`,
      `PART2_MAX_LETTERS: ${part2MaxLetters.value}`,
      `TLD: ${(tlds.length ? tlds : ['.com', '.ai', '.tech']).join(', ')}`,
      `CONTEXT: ${words.join(' ')}`,
      `SUBSTITUTIONS: ${substitutions.value.join(', ')}`,
      `STRATEGIES: ${strategies.value.join(', ')}`,
      `MAX_SYLLABLES: ${maxSyllables.value}`,
      `MAX_CONSONANTS: ${maxConsonants.value}`,
      `MAX_LENGTH: ${maxLength.value}`,
      `MAX_NAMES: ${maxNames.value}`,
    ].join('\n')
  }

  /** Return derived brief values so URL serialization can omit them. */
  function getBriefDefaults() {
    const parsed = parseBrief(brief.value)
    return {
      part1: expandRoots(parsed.part1Roots).join(' '),
      part2: expandRoots(parsed.part2Roots).join(' '),
      tlds: (parsed.tlds.length ? parsed.tlds : ['.com', '.ai', '.tech']).join(', '),
      context: parsed.words.join(' '),
    }
  }

  /** Generate candidate domains from the current editable effective query. */
  function generate() {
    if (!effectiveQuery.value.trim()) expandBrief()
    const query = parseEffectiveQuery(effectiveQuery.value)
    if (!query.part1Roots.length || !query.part2Roots.length || !query.tlds.length) return
    keywords.value = query.context || keywords.value
    maxSyllables.value = query.maxSyllables
    maxConsonants.value = query.maxConsonants
    maxLength.value = query.maxLength
    part1MinLetters.value = query.part1Limits.minLetters
    part1MaxLetters.value = query.part1Limits.maxLetters
    part2MinLetters.value = query.part2Limits.minLetters
    part2MaxLetters.value = query.part2Limits.maxLetters
    substitutions.value = query.substitutions
    strategies.value = query.strategies
    maxNames.value = query.maxNames

    // Thesaurus additions widen generation without being written back into the
    // user's own PART1/PART2 text, so "Generate & check" never rewrites their input.
    const part1Roots = unique([...query.part1Roots, ...thesaurusAdditions.value.part1])
    const part2Roots = unique([...query.part2Roots, ...thesaurusAdditions.value.part2])
    const part1Variants = expandVariantsToLetterLimits(
      dedupeVariants(part1Roots.flatMap((root) => spellingVariantRecords(root, query.substitutions))),
      query.part1Limits,
    )
    const part2Variants = expandVariantsToLetterLimits(
      dedupeVariants(part2Roots.flatMap((root) => spellingVariantRecords(root, query.substitutions))),
      query.part2Limits,
    )
    const candidates = dedupeCandidates(part1Variants.flatMap((left) => part2Variants.flatMap((right) =>
      generateCreativeNames(left.name, right.name, query.strategies, query.maxConsonants, left.editCost + right.editCost, query.part1Limits, query.part2Limits))))
      .filter(({ name }) => name.length >= 4 && name.length <= query.maxLength)
      .filter(({ name }) => countSyllables(name) <= query.maxSyllables)
      .filter(({ name }) => longestConsonantRun(name) <= query.maxConsonants)
      .sort((a, b) => candidateScore(b) - candidateScore(a) || a.name.length - b.name.length)
    const names = selectDiverseNames(candidates, query.maxNames)

    const generated = names.flatMap((name) => query.tlds.map((tld) => ({
      id: `${name}.${tld}`,
      name: `${name}.${tld}`,
      brand: name,
      tld,
      status: 'idle',
      availability: null,
      search: null,
    })))
    resultsLimited.value = !proUnlocked.value && generated.length > freeTierResultLimit
    results.value = resultsLimited.value ? generated.slice(0, freeTierResultLimit) : generated
    track('search_run', { resultCount: results.value.length, limited: resultsLimited.value })
  }

  /** Expand both name parts with short, semantically related alternatives from Datamuse and an LLM. */
  async function enrichWithThesaurus() {
    if (!useThesaurus.value) {
      thesaurusAdditions.value = { part1: [], part2: [] }
      return
    }
    enriching.value = true
    try {
      const { part1Roots, part2Roots } = parseBrief(brief.value)
      const [part1Additions, part2Additions] = await Promise.all([
        enrichWords(part1Roots.slice(0, 3)),
        enrichWords(part2Roots.slice(0, 3)),
      ])
      thesaurusAdditions.value = { part1: part1Additions, part2: part2Additions }
    } finally { enriching.value = false }
  }

  /** @param {string[]} words @returns {Promise<string[]>} */
  async function enrichWords(words) {
    const additions = await Promise.all(words.map(async (word) => {
      const [datamuse, ai] = await Promise.all([
        fetchSynonyms(word, maxSyllables.value),
        flags.aiSuggestions ? fetchAiSynonyms(word, maxSyllables.value) : Promise.resolve([]),
      ])
      return unique([...datamuse, ...ai])
    }))
    return unique(additions.flat())
  }

  /** @param {DomainCandidate} item */
  async function checkOne(item) {
    const cached = await readCachedLookup(item.name, keywords.value)
    if (cached) {
      applyLookup(item, cached)
      return
    }
    item.status = 'checking'
    try {
      const [availability, search] = await Promise.all([
        checkDomainInBrowser(item.name),
        flags.searchResults ? checkSearchOnServer(item.name, keywords.value) : Promise.resolve(null),
      ])
      const data = { ...availability, search }
      await writeCachedLookup(item.name, keywords.value, data)
      applyLookup(item, data)
    } catch {
      item.status = 'error'
      item.availability = 'unknown'
      item.availabilityNote = 'RDAP lookup failed after browser and server attempts.'
    }
  }

  /** Check unchecked domains in small batches to avoid hammering RDAP services. */
  async function checkAll() {
    running.value = true
    stopRequested = false
    const queue = results.value
      .filter((item) => item.status === 'idle' || item.status === 'error')
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    for (let index = 0; index < queue.length; index += 4) {
      if (stopRequested) break
      await Promise.all(queue.slice(index, index + 4).map(checkOne))
      if (index + 4 < queue.length) await delay(180)
    }
    running.value = false
  }

  /** Let the in-flight batch finish, then stop scheduling further checks. */
  function stopChecking() {
    stopRequested = true
  }

  expandBrief()
  const defaults = { brief: defaultBrief, substitutions: defaultSubstitutions, strategies: defaultStrategies, maxSyllables: 3, maxConsonants: 2, maxLength: 'innotek'.length, maxNames: 150, part1MinLetters: defaultPartMinLetters, part1MaxLetters: defaultPartMaxLetters, part2MinLetters: defaultPartMinLetters, part2MaxLetters: defaultPartMaxLetters }
  return { brief, effectiveQuery, keywords, maxSyllables, maxConsonants, maxLength, maxNames, part1MinLetters, part1MaxLetters, part2MinLetters, part2MaxLetters, substitutions, strategies, useThesaurus, enriching, results, resultsLimited, freeTierResultLimit, running, checkedCount, availableCount, defaults, getBriefDefaults, expandBrief, enrichWithThesaurus, generate, checkOne, checkAll, stopChecking }
})

/**
 * Read the brief line by line: line 1 is part 1's words, line 2 is part 2's
 * words, and any further lines add extra context keywords. A leading dot
 * marks a TLD on any line, independent of that line-based structure.
 * @param {string} source
 */
function parseBrief(source) {
  const lines = source.split('\n')
  const tlds = unique(source.split(/[\s,]+/).map((token) => token.trim()).filter((token) => token.startsWith('.')).map((token) => `.${clean(token)}`))

  let part1Roots = wordsOfLine(lines[0])
  let part2Roots = wordsOfLine(lines[1])
  const extraWords = lines.slice(2).flatMap(wordsOfLine)
  const words = unique([...part1Roots, ...part2Roots, ...extraWords])

  if (!part2Roots.length) part2Roots = part1Roots
  if (!part1Roots.length) part1Roots = ['inno']
  if (!part2Roots.length) part2Roots = ['tech']
  return { part1Roots, part2Roots, tlds, words }
}

/** @param {string|undefined} line */
function wordsOfLine(line) {
  return unique((line || '').split(/[\s,]+/).map((token) => token.trim()).filter((token) => token && !token.startsWith('.')).map(clean))
}

/** @param {string} word @param {number} maxSyllables @returns {Promise<string[]>} */
async function fetchSynonyms(word, maxSyllables) {
  const cacheKey = `domainmate.thesaurus.${word}.${maxSyllables}`
  try {
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached)
    const params = new URLSearchParams({ ml: word, sp: `${word[0]}*`, max: '5', md: 's' })
    const response = await fetch(`https://api.datamuse.com/words?${params}`, { signal: AbortSignal.timeout(6000) })
    if (!response.ok) throw new Error('Thesaurus unavailable')
    const data = await response.json()
    const words = unique(data.filter((item) => Number(item.numSyllables || 99) <= maxSyllables)
      .map((item) => clean(item.word)).filter((item) => item.length >= 3 && item.length <= 12))
    sessionStorage.setItem(cacheKey, JSON.stringify(words))
    return words
  } catch { return localSynonyms[word] || [] }
}

/** Ask the server-side LangChain endpoint for LLM-suggested alternatives; returns [] when not configured. */
async function fetchAiSynonyms(word, maxSyllables) {
  const cacheKey = `domainmate.ai.${word}.${maxSyllables}`
  try {
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached)
    const params = new URLSearchParams({ word, maxSyllables: String(maxSyllables) })
    const response = await fetch(`/api/suggest?${params}`, { signal: AbortSignal.timeout(9000) })
    if (!response.ok) return []
    const data = await response.json()
    const words = Array.isArray(data.words) ? data.words : []
    sessionStorage.setItem(cacheKey, JSON.stringify(words))
    return words
  } catch { return [] }
}

const localSynonyms = {
  innovation: ['invention', 'imagination', 'insight'],
  idea: ['insight', 'inspiration'],
  technology: ['tech', 'tool'],
  topic: ['theme', 'thread'],
}

/** @param {string[]} roots */
function expandRoots(roots) {
  return unique(roots.flatMap((root) => [root, root.slice(0, 3), root.slice(0, 4), root.slice(0, 5)]))
    .filter((root) => root.length >= 2)
}

/** Check HTTPS and DNS in the browser before asking RDAP for a definitive result. */
async function checkDomainInBrowser(domain) {
  if (await respondsOverHttps(domain)) {
    return { availability: 'registered', availabilityNote: 'An HTTPS server responded for this domain.' }
  }
  if (await hasDnsDelegation(domain)) {
    return { availability: 'registered', availabilityNote: 'The domain has delegated DNS nameservers, although no HTTPS server responded.' }
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        headers: { Accept: 'application/rdap+json, application/json' },
        signal: AbortSignal.timeout(9000),
      })
      if (response.status === 404) {
        if (isRdapJson(response)) {
          return { availability: 'available', availabilityNote: 'No HTTPS endpoint or DNS delegation was found, and RDAP returned not found.' }
        }
        return { availability: 'unknown', availabilityNote: 'No HTTPS endpoint or DNS delegation was found, but RDAP does not support this TLD.' }
      }
      if (response.ok) return { availability: 'registered' }
      if (response.status === 429 && attempt === 0) {
        await delay(retryDelay(response.headers, 500))
        continue
      }
      throw new Error(`Registry returned ${response.status}.`)
    }
  } catch (directError) {
    try {
      const response = await fetch(`/api/domain-check?domain=${encodeURIComponent(domain)}`, {
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) return { availability: 'unknown', availabilityNote: directError instanceof Error ? directError.message : 'Registry lookup failed.' }
      const result = await response.json()
      if (result.availability === 'unknown' && !result.availabilityNote) result.availabilityNote = 'The registry did not return a definitive response.'
      return result
    } catch {
      return { availability: 'unknown', availabilityNote: 'Both browser and server registry lookups failed or timed out.' }
    }
  }
}

/** A successful opaque response proves that the domain has an HTTPS endpoint. */
async function respondsOverHttps(domain) {
  try {
    // no-cors requests only support redirect:'follow'; 'manual'/'error' throw immediately.
    await fetch(`https://${domain}/`, {
      method: 'HEAD', mode: 'no-cors', cache: 'no-store', redirect: 'follow',
      referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(2500),
    })
    return true
  } catch { return false }
}

/** @param {Response} response */
function isRdapJson(response) {
  return response.headers.get('content-type')?.toLowerCase().includes('json') === true
}

/**
 * Query public DNS from the browser; an NS answer proves that the domain is delegated.
 * A failed lookup is inconclusive and must still fall through to RDAP.
 * @param {string} domain
 * @returns {Promise<boolean>}
 */
async function hasDnsDelegation(domain) {
  try {
    const query = new URLSearchParams({ name: domain, type: 'NS' })
    const response = await fetch(`https://dns.google/resolve?${query}`, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return false
    const result = await response.json()
    return result.Status === 0
      && Array.isArray(result.Answer)
      && result.Answer.some((answer) => answer?.type === 2)
  } catch { return false }
}

/** Honor Retry-After or rate-limit reset headers with a bounded wait. */
function retryDelay(headers, fallback) {
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()
    if (Number.isFinite(milliseconds)) return Math.min(5000, Math.max(100, milliseconds))
  }
  const reset = Number(headers.get('ratelimit-reset') || headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) {
    const milliseconds = reset > 1e9 ? reset * 1000 - Date.now() : reset * 1000
    return Math.min(5000, Math.max(100, milliseconds))
  }
  return fallback
}

/** @param {number} milliseconds */
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

/** Keep provider credentials server-side while normalizing the response for the browser. */
async function checkSearchOnServer(domain, keywords) {
  const params = new URLSearchParams({ domain, keywords })
  try {
    const response = await fetch(`/api/search?${params}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return { status: 'error', query: `\"${domain}\" ${keywords}` }
    return response.json()
  } catch {
    return { status: 'error', query: `\"${domain}\" ${keywords}` }
  }
}

/** @param {DomainCandidate} item @param {{availability: Availability, availabilityNote?: string, search?: SearchResult}} data */
function applyLookup(item, data) {
  item.availability = data.availability
  item.availabilityNote = data.availabilityNote
  item.search = data.search || null
  item.status = 'done'
}

/**
 * Produce common brandable phonetic substitutions without recursively
 * expanding generated variants. Terminal "ch" is treated as a single sound,
 * so "tech" becomes "tek", "teck", and "tekk".
 * @param {string} root
 * @param {string[]} enabledRules
 * @returns {string[]}
 */
function spellingVariants(root, enabledRules) {
  const variants = [root]
  for (const rule of enabledRules) {
    const [source, replacement] = rule.split(':')
    if (source === 'double') {
      if (root.includes(replacement)) variants.push(root.replace(replacement, `${replacement}${replacement}`))
      continue
    }
    if (source === 'drop') {
      if (root.includes(replacement)) variants.push(root.replace(replacement, ''))
      continue
    }
    if (source === 'skip') {
      if (replacement === 'first' && root.length > 3) variants.push(root.slice(1))
      if (replacement === 'last' && root.length > 3) variants.push(root.slice(0, -1))
      continue
    }
    const pattern = source === 'ch' ? /ch$/g : source === 'c' ? /c(?!h)/g : new RegExp(source, 'g')
    if (pattern.test(root)) variants.push(root.replace(pattern, replacement))
  }
  return unique(variants)
}

/** @param {string} root @param {string[]} rules */
function spellingVariantRecords(root, rules) {
  return spellingVariants(root, rules).map((name) => ({ name, editCost: name === root ? 0 : 1 }))
}

/** Keep the lowest edit cost for duplicate spelling variants. */
function dedupeVariants(variants) {
  const best = new Map()
  for (const variant of variants) {
    const current = best.get(variant.name)
    if (!current || variant.editCost < current.editCost) best.set(variant.name, variant)
  }
  return [...best.values()]
}

/**
 * Materialize every permitted prefix when a user narrows a part range. Keeping
 * the default range untouched preserves the established candidate ordering.
 * @param {{name: string, editCost: number}[]} variants
 * @param {PartLetterLimits} limits
 * @returns {{name: string, editCost: number}[]}
 */
function expandVariantsToLetterLimits(variants, limits) {
  if (limits.minLetters === defaultPartMinLetters && limits.maxLetters === defaultPartMaxLetters) return variants
  const expanded = []
  for (const variant of variants) {
    const upper = Math.min(limits.maxLetters, variant.name.length)
    for (let length = limits.minLetters; length <= upper; length += 1) {
      expanded.push({ ...variant, name: variant.name.slice(0, length) })
    }
  }
  return dedupeVariants(expanded)
}

/**
 * Generate deterministic brand structures while leaving pronunciation filters
 * to the shared post-processing pipeline.
 * @param {string} left
 * @param {string} right
 * @param {string[]} enabled
 * @param {number} maxConsonants
 * @param {number} editCost
 * @param {PartLetterLimits} part1Limits
 * @param {PartLetterLimits} part2Limits
 */
function generateCreativeNames(left, right, enabled, maxConsonants, editCost, part1Limits, part2Limits) {
  const names = []
  const use = (strategy) => enabled.includes(strategy)
  const leftCuts = prefixCuts(left)
  const rightCuts = prefixCuts(right)
  const direct = `${left}${right}`
  /** Keep only paths whose actual source-part contributions satisfy both ranges. */
  const add = (name, strategy, quality = 0, part1Used = left.length, part2Used = right.length) => {
    if (!withinPartLetterLimits(part1Used, part1Limits) || !withinPartLetterLimits(part2Used, part2Limits)) return
    names.push({ name: clean(name), strategy, quality: quality - editCost * 5 })
  }

  if (use('direct')) {
    add(direct, 'direct', 12)
    add(`${left.slice(0, 4)}${right}`, 'direct', 7, Math.min(4, left.length), right.length)
    add(`${left}${right.slice(0, 4)}`, 'direct', 7, left.length, Math.min(4, right.length))
  }
  if (use('blend')) {
    for (const start of leftCuts) for (const end of rightCuts) {
      add(`${start}${end}`, 'blend', start.length + end.length >= 7 ? 6 : 2, start.length, end.length)
    }
  }
  if (use('overlap')) {
    const overlap = mergeOverlap(left, right)
    add(overlap, 'overlap', overlap === direct ? 2 : 10)
    add(collapseBoundary(left, right), 'overlap', 8)
  }
  if (use('bridge')) {
    if (boundaryConsonantRun(left, right) > maxConsonants) add(`${left}${bridgeVowel(left)}${right}`, 'bridge', 4)
  }
  if (use('compact')) {
    if (!/^([a-z])\1/.test(right)) add(`${left[0]}${right}`, 'compact', 4, 1, right.length)
    add(`${left.slice(0, 4)}${right.slice(0, 3)}`, 'compact', 6, Math.min(4, left.length), Math.min(3, right.length))
    add(`${left.slice(0, 3)}${right.slice(0, 4)}`, 'compact', 5, Math.min(3, left.length), Math.min(4, right.length))
    add(`${left.slice(0, 2)}${right}`, 'compact', 3, Math.min(2, left.length), right.length)
  }
  if (use('suffix')) {
    const stem = collapseBoundary(left.slice(0, 4), right.slice(0, 3))
    for (const suffix of ['labs', 'flow', 'forge', 'base']) {
      add(`${stem}${suffix}`, 'suffix', 1, Math.min(4, left.length), Math.min(3, right.length))
    }
  }
  if (use('reverse')) {
    add(`${right}${left}`, 'reverse', 2)
    add(mergeOverlap(right, left), 'reverse', 4)
    add(collapseBoundary(right, left), 'reverse', 3)
  }
  return names
}

/**
 * Check one strategy path's source contribution against a part's limits.
 * @param {number} used
 * @param {PartLetterLimits} limits
 */
function withinPartLetterLimits(used, limits) {
  return used >= limits.minLetters && used <= limits.maxLetters
}

/** Return useful prefix/suffix cuts while avoiding one-character fragments. */
function prefixCuts(value) {
  const middle = Math.max(2, Math.ceil(value.length * 0.6))
  return unique([value.slice(0, middle), value.slice(0, Math.max(2, middle - 1)), value.slice(0, Math.min(5, value.length)), value])
}

/** Merge the longest shared boundary, for example "inter" + "terminal". */
function mergeOverlap(left, right) {
  const max = Math.min(left.length, right.length, 5)
  for (let size = max; size >= 1; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return `${left}${right.slice(size)}`
  }
  return `${left}${right}`
}

/** Collapse repeated letters at a compound boundary. */
function collapseBoundary(left, right) {
  return left.at(-1) === right[0] ? `${left}${right.slice(1)}` : `${left}${right}`
}

/** @param {string|undefined} character */
function isConsonant(character) {
  return Boolean(character && /[a-z]/.test(character) && !/[aeiouy]/.test(character))
}

/** Count consecutive consonants spanning the join between two parts. */
function boundaryConsonantRun(left, right) {
  const tail = left.match(/[^aeiouy]+$/)?.[0].length || 0
  const head = right.match(/^[^aeiouy]+/)?.[0].length || 0
  return tail + head
}

/** Reuse the last vowel for a more harmonious bridge, falling back to "i". */
function bridgeVowel(value) {
  return value.match(/[aeiouy](?!.*[aeiouy])/)?.[0] || 'i'
}

/** Keep the highest-quality provenance when strategies generate the same name. */
function dedupeCandidates(candidates) {
  const best = new Map()
  for (const candidate of candidates) {
    const current = best.get(candidate.name)
    if (!current || candidate.quality > current.quality) best.set(candidate.name, candidate)
  }
  return [...best.values()]
}

/** Limit spelling-family repetition before filling the configured result count. */
function selectDiverseNames(candidates, limit) {
  const familyCounts = new Map()
  const selected = []
  for (const candidate of candidates) {
    const family = phoneticFamily(candidate.name)
    const count = familyCounts.get(family) || 0
    if (count >= 15) continue
    selected.push(candidate.name)
    familyCounts.set(family, count + 1)
    if (selected.length >= limit) break
  }
  return selected
}

/** @param {string} name */
function phoneticFamily(name) {
  return name.replace(/ph/g, 'f').replace(/ch|ck|kk|c/g, 'k').replace(/(.)\1+/g, '$1').replace(/y/g, 'i').replace(/z/g, 's')
}

/** @param {string} source @returns {EffectiveQuery} */
function parseEffectiveQuery(source) {
  /** @type {EffectiveQuery} */
  const parsed = {
    part1Roots: [], part2Roots: [],
    part1Limits: { minLetters: defaultPartMinLetters, maxLetters: defaultPartMaxLetters },
    part2Limits: { minLetters: defaultPartMinLetters, maxLetters: defaultPartMaxLetters },
    tlds: [], context: '', substitutions: [], strategies: [],
    maxSyllables: 3, maxConsonants: 2, maxLength: 'innotek'.length, maxNames: 150,
  }
  for (const line of source.split('\n')) {
    const [rawKey, ...rest] = line.split(':')
    const key = rawKey.trim().toUpperCase()
    const value = rest.join(':').trim()
    const values = value.split(/[\s,]+/).map(clean).filter(Boolean)
    if (key === 'PART1') parsed.part1Roots = unique(values)
    if (key === 'PART2') parsed.part2Roots = unique(values)
    if (key === 'PART1_MIN_LETTERS') parsed.part1Limits.minLetters = clampOption(value, defaultPartMinLetters, defaultPartMaxLetters, defaultPartMinLetters)
    if (key === 'PART1_MAX_LETTERS') parsed.part1Limits.maxLetters = clampOption(value, defaultPartMinLetters, defaultPartMaxLetters, defaultPartMaxLetters)
    if (key === 'PART2_MIN_LETTERS') parsed.part2Limits.minLetters = clampOption(value, defaultPartMinLetters, defaultPartMaxLetters, defaultPartMinLetters)
    if (key === 'PART2_MAX_LETTERS') parsed.part2Limits.maxLetters = clampOption(value, defaultPartMinLetters, defaultPartMaxLetters, defaultPartMaxLetters)
    if (key === 'TLD') parsed.tlds = unique(values)
    if (key === 'CONTEXT') parsed.context = value
    if (key === 'SUBSTITUTIONS') parsed.substitutions = value.split(/[\s,]+/).filter((rule) => /^[a-z]+:[a-z]+$/.test(rule))
    if (key === 'STRATEGIES') parsed.strategies = value.split(/[\s,]+/).filter((strategy) => /^[a-z]+$/.test(strategy))
    if (key === 'MAX_SYLLABLES') parsed.maxSyllables = clampOption(value, 1, 8, 3)
    if (key === 'MAX_CONSONANTS') parsed.maxConsonants = clampOption(value, 1, 6, 2)
    if (key === 'MAX_LENGTH') parsed.maxLength = clampOption(value, 4, 24, 'innotek'.length)
    if (key === 'MAX_NAMES') parsed.maxNames = clampOption(value, 1, 400, 150)
  }
  parsed.part1Limits = normalizePartLetterLimits(parsed.part1Limits)
  parsed.part2Limits = normalizePartLetterLimits(parsed.part2Limits)
  if (!parsed.substitutions.length) parsed.substitutions = [...defaultSubstitutions]
  if (!parsed.strategies.length) parsed.strategies = [...defaultStrategies]
  return parsed
}

/**
 * Clamp and order a user-editable minimum/maximum pair.
 * @param {PartLetterLimits} limits
 * @returns {PartLetterLimits}
 */
function normalizePartLetterLimits(limits) {
  const first = clampOption(String(limits.minLetters), defaultPartMinLetters, defaultPartMaxLetters, defaultPartMinLetters)
  const second = clampOption(String(limits.maxLetters), defaultPartMinLetters, defaultPartMaxLetters, defaultPartMaxLetters)
  return { minLetters: Math.min(first, second), maxLetters: Math.max(first, second) }
}

/** Count pronounceable units using contiguous vowel groups, including "y". */
function countSyllables(name) {
  return Math.max(1, name.match(/[aeiouy]+/g)?.length || 0)
}

/** @param {string} name */
function longestConsonantRun(name) {
  return Math.max(0, ...(name.match(/[^aeiouy]+/g) || []).map((part) => part.length))
}

/** @param {string} value @param {number} min @param {number} max @param {number} fallback */
function clampOption(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

/** @param {string} name */
function score(name) {
  const syllables = countSyllables(name)
  const lengthScore = Math.max(0, 12 - Math.abs(name.length - 9) * 2)
  const repeatedPenalty = /([a-z])\1\1/.test(name) ? 8 : 0
  return lengthScore
    + (syllables >= 2 && syllables <= 3 ? 5 : 0)
    - repeatedPenalty
}

/** @param {{name: string, quality: number}} candidate */
function candidateScore(candidate) {
  return score(candidate.name) + candidate.quality
}
