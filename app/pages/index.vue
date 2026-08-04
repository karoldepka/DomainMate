<script setup>
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDomainStore } from '../stores/domain.js'
import { getClientId, loadAndSyncFavorites, saveRating } from '../services/favorites.js'
import { locale, locales, t } from '../i18n/index.js'
import { flags, proUnlocked } from '../featureFlags.js'

const store = useDomainStore()
const { brief, effectiveQuery, keywords, part1MinLetters, part1MaxLetters, part2MinLetters, part2MaxLetters, maxSyllables, maxConsonants, maxLength, maxNames, substitutions, strategies, useThesaurus, enriching, results, resultsLimited, running, checkedCount, availableCount } = storeToRefs(store)
const progressText = computed(() => t('results.progress', { checked: checkedCount.value, total: results.value.length }))
const paymentDialog = useTemplateRef('paymentDialog')
const feedbackDialog = useTemplateRef('feedbackDialog')
const privacyDialog = useTemplateRef('privacyDialog')
const credits = ref(5)
const availableOnly = ref(true)
const favorites = ref(new Map())
const showFlagsPanel = ref(false)
const logoClicks = ref(0)
const languageItems = computed(() => locales.map((item) => ({ label: item.label, value: item.code })))
const briefPlaceholder = 'inno inter\ntech tek\n.dev .ai .com'
const workspaceStorageKey = 'domainmate.workspace'
let logoClickResetTimer
/** Highest rated first, then shortest first among equally rated candidates. */
const displayedResults = computed(() => {
  const items = availableOnly.value ? results.value.filter((item) => item.availability !== 'registered') : [...results.value]
  return items.sort((a, b) => ratingRank(a) - ratingRank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name))
})
const part1 = computed({ get: () => getQueryLine('PART1'), set: (value) => setQueryLine('PART1', value) })
const part2 = computed({ get: () => getQueryLine('PART2'), set: (value) => setQueryLine('PART2', value) })
const substitutionOptions = [
  ['ch:k', 'ch → k'], ['ch:ck', 'ch → ck'], ['ch:kk', 'ch → kk'],
  ['cs:x', 'cs → x'], ['c:k', 'c → k'], ['c:ck', 'c → ck'], ['c:kk', 'c → kk'],
  ['ph:f', 'ph → f'], ['x:ks', 'x → ks'], ['s:z', 's → z'],
  ['i:y', 'i → y'], ['y:i', 'y → i'], ['oo:u', 'oo → u'], ['qu:k', 'qu → k'],
  ['double:n', 'double n'], ['double:t', 'double t'], ['double:k', 'double k'], ['double:l', 'double l'], ['double:r', 'double r'],
  ['drop:e', 'drop e'], ['drop:o', 'drop o'],
  ['skip:first', 'skip 1st letter'], ['skip:last', 'skip last letter'],
]
const strategyOptions = [
  ['direct', 'strategy.direct'], ['blend', 'strategy.blend'], ['overlap', 'strategy.overlap'],
  ['bridge', 'strategy.bridge'], ['compact', 'strategy.compact'], ['suffix', 'strategy.suffix'],
  ['reverse', 'strategy.reverse'],
]

onMounted(async () => {
  credits.value = Number(localStorage.getItem('domainmate.credits') || 5)
  restoreSavedWorkspace()
  restoreQueryParams()
  store.generate()
  syncQueryParams()
  favorites.value = await loadAndSyncFavorites()
  restoreProUnlock()
})

/** Restore pro-tier flags for a returning visitor who already sent feedback from this device. */
async function restoreProUnlock() {
  try {
    const clientId = await getClientId()
    const response = await fetch(`/api/feedback/status?clientId=${encodeURIComponent(clientId)}`)
    if (!response.ok) return
    const data = await response.json()
    if (data.unlocked) {
      flags.searchResults = true
      flags.aiSuggestions = true
      flags.favoritesSync = true
    }
  } catch { /* Stay on free tier if the check fails. */ }
}

/** When there's no shareable link, re-apply the last-used workspace before restoring from the URL. */
function restoreSavedWorkspace() {
  if (window.location.search) return
  const saved = localStorage.getItem(workspaceStorageKey)
  if (saved) window.history.replaceState({}, '', `${window.location.pathname}?${saved}`)
}

watch([brief, effectiveQuery, part1MinLetters, part1MaxLetters, part2MinLetters, part2MaxLetters, maxSyllables, maxConsonants, maxLength, maxNames, availableOnly, useThesaurus], syncQueryParams)

/** Enrich parts, generate candidates, and begin availability checks. */
async function submit() { await store.enrichWithThesaurus(); store.generate(); store.checkAll() }

/** @param {{name: string, search?: {query?: string}|null}} item */
function googleUrl(item) {
  const query = item.search?.query || `\"${item.name}\" ${keywords.value}`
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

/** @param {{name: string}} item */
function domainUrl(item) {
  return `https://${item.name}`
}

/** @param {number} value */
function formatCount(value) {
  return new Intl.NumberFormat('en', { notation: value >= 10000 ? 'compact' : 'standard' }).format(value)
}

/** @param {{name: string, copied?: boolean}} item */
async function copyDomain(item) {
  await navigator.clipboard.writeText(item.name)
  item.copied = true
  window.setTimeout(() => { item.copied = false }, 1200)
}

/** Add credits after server-side Checkout verification. */
function addCredits(amount) {
  credits.value += Number(amount)
  localStorage.setItem('domainmate.credits', String(credits.value))
}

/** Five clicks on the logo within two seconds reveals the hidden feature-flags panel. */
function handleLogoClick() {
  logoClicks.value += 1
  window.clearTimeout(logoClickResetTimer)
  logoClickResetTimer = window.setTimeout(() => { logoClicks.value = 0 }, 2000)
  if (logoClicks.value >= 5) {
    logoClicks.value = 0
    showFlagsPanel.value = true
  }
}

/** @param {{name: string}} item */
function ratingOf(item) { return favorites.value.get(item.name) || 0 }

/** @param {{name: string}} item */
function ratingRank(item) { return -ratingOf(item) }

/** @param {{name: string}} item @param {number} value */
async function setRating(item, value) {
  const next = ratingOf(item) === value ? 0 : value
  const map = new Map(favorites.value)
  if (next > 0) map.set(item.name, next)
  else map.delete(item.name)
  favorites.value = map
  await saveRating(item.name, next)
}

/** @param {string} key */
function getQueryLine(key) {
  const line = effectiveQuery.value.split('\n').find((item) => item.toUpperCase().startsWith(`${key}:`))
  // Only trim the leading "KEY: " space, not trailing whitespace - trimming both ends here
  // would erase a space the user just typed at the end of a live-bound textarea (issue #3).
  return line?.split(':').slice(1).join(':').replace(/^\s+/, '') || ''
}

/** @param {string} key @param {string} value */
function setQueryLine(key, value) {
  const lines = effectiveQuery.value.split('\n')
  const index = lines.findIndex((item) => item.toUpperCase().startsWith(`${key}:`))
  const nextLine = `${key}: ${value}`
  if (index >= 0) lines[index] = nextLine
  else lines.push(nextLine)
  effectiveQuery.value = lines.join('\n')
}

/** Copy selected substitution chips into the effective query. */
function syncSubstitutions() { setQueryLine('SUBSTITUTIONS', substitutions.value.join(', ')) }

/** Copy selected generation strategies into the effective query. */
function syncStrategies() { setQueryLine('STRATEGIES', strategies.value.join(', ')) }

/**
 * Copy a per-part letter limit into the editable effective query.
 * @param {string} key
 * @param {number|string} value
 */
function syncPartLimit(key, value) { setQueryLine(key, String(value)) }

/** Restore a shareable naming workspace from its URL. */
function restoreQueryParams() {
  const params = new URLSearchParams(window.location.search)
  const legacyGeneratedUrl = params.has('query')
  if (params.has('brief')) brief.value = params.get('brief') || brief.value
  if (params.has('syllables')) maxSyllables.value = Number(params.get('syllables')) || 3
  if (params.has('consonants')) maxConsonants.value = Number(params.get('consonants')) || 2
  if (params.has('length')) maxLength.value = Number(params.get('length')) || 'innotek'.length
  if (params.has('maxNames')) maxNames.value = Number(params.get('maxNames')) || 150
  const part1Limits = normalizeLetterRange(
    restoreLetterLimit(params, 'p1min', store.defaults.part1MinLetters),
    restoreLetterLimit(params, 'p1max', store.defaults.part1MaxLetters),
  )
  const part2Limits = normalizeLetterRange(
    restoreLetterLimit(params, 'p2min', store.defaults.part2MinLetters),
    restoreLetterLimit(params, 'p2max', store.defaults.part2MaxLetters),
  )
  part1MinLetters.value = part1Limits.min
  part1MaxLetters.value = part1Limits.max
  part2MinLetters.value = part2Limits.min
  part2MaxLetters.value = part2Limits.max
  if (params.has('available')) availableOnly.value = params.get('available') === '1'
  store.expandBrief()
  if (params.has('part1')) setQueryLine('PART1', params.get('part1') || '')
  if (params.has('part2')) setQueryLine('PART2', params.get('part2') || '')
  if (params.has('tlds')) setQueryLine('TLD', params.get('tlds') || '')
  if (params.has('context')) setQueryLine('CONTEXT', params.get('context') || '')
  if (params.has('subs')) {
    const restored = (params.get('subs') || '').split(',').filter(Boolean)
    const legacyDefaults = ['ch:k', 'ch:ck', 'ch:kk', 'cs:x', 'c:k', 'c:ck', 'c:kk', 'ph:f', 'x:ks', 's:z']
    if (!(legacyGeneratedUrl && restored.join(',') === legacyDefaults.join(','))) substitutions.value = restored
    syncSubstitutions()
  }
  if (params.has('thesaurus')) useThesaurus.value = params.get('thesaurus') !== '0'
  if (params.has('strategies')) {
    strategies.value = (params.get('strategies') || '').split(',').filter(Boolean)
    syncStrategies()
  }
}

/** Keep all user-editable generation parameters in the address bar. */
function syncQueryParams() {
  const params = new URLSearchParams()
  const baseline = store.getBriefDefaults()
  const effectivePart1Limits = normalizeLetterRange(
    normalizeLetterLimit(getQueryLine('PART1_MIN_LETTERS'), store.defaults.part1MinLetters),
    normalizeLetterLimit(getQueryLine('PART1_MAX_LETTERS'), store.defaults.part1MaxLetters),
  )
  const effectivePart2Limits = normalizeLetterRange(
    normalizeLetterLimit(getQueryLine('PART2_MIN_LETTERS'), store.defaults.part2MinLetters),
    normalizeLetterLimit(getQueryLine('PART2_MAX_LETTERS'), store.defaults.part2MaxLetters),
  )
  setOverride(params, 'brief', brief.value, store.defaults.brief)
  setOverride(params, 'part1', part1.value, baseline.part1)
  setOverride(params, 'part2', part2.value, baseline.part2)
  setOverride(params, 'p1min', String(effectivePart1Limits.min), String(store.defaults.part1MinLetters))
  setOverride(params, 'p1max', String(effectivePart1Limits.max), String(store.defaults.part1MaxLetters))
  setOverride(params, 'p2min', String(effectivePart2Limits.min), String(store.defaults.part2MinLetters))
  setOverride(params, 'p2max', String(effectivePart2Limits.max), String(store.defaults.part2MaxLetters))
  setOverride(params, 'tlds', getQueryLine('TLD'), baseline.tlds)
  setOverride(params, 'context', getQueryLine('CONTEXT'), baseline.context)
  setOverride(params, 'subs', normalizeList(getQueryLine('SUBSTITUTIONS')), store.defaults.substitutions.join(','))
  setOverride(params, 'strategies', normalizeList(getQueryLine('STRATEGIES')), store.defaults.strategies.join(','))
  setOverride(params, 'syllables', getQueryLine('MAX_SYLLABLES'), String(store.defaults.maxSyllables))
  setOverride(params, 'consonants', getQueryLine('MAX_CONSONANTS'), String(store.defaults.maxConsonants))
  setOverride(params, 'length', getQueryLine('MAX_LENGTH'), String(store.defaults.maxLength))
  setOverride(params, 'maxNames', getQueryLine('MAX_NAMES'), String(store.defaults.maxNames))
  if (!useThesaurus.value) params.set('thesaurus', '0')
  if (!availableOnly.value) params.set('available', '0')
  const query = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  try { localStorage.setItem(workspaceStorageKey, query) } catch { /* Storage can be unavailable in privacy modes. */ }
}

/** @param {URLSearchParams} params @param {string} key @param {string} value @param {string} baseline */
function setOverride(params, key, value, baseline) {
  if (value.trim() !== baseline.trim()) params.set(key, value)
}

/** @param {string} value */
function normalizeList(value) { return value.split(/[\s,]+/).filter(Boolean).join(',') }

/**
 * Restore a bounded integer letter limit while keeping malformed URLs harmless.
 * @param {URLSearchParams} params
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function restoreLetterLimit(params, key, fallback) {
  if (!params.has(key)) return fallback
  return normalizeLetterLimit(params.get(key), fallback)
}

/** @param {string|null} source @param {number} fallback @returns {number} */
function normalizeLetterLimit(source, fallback) {
  if (source === null || String(source).trim() === '') return fallback
  const value = Number(source)
  return Number.isInteger(value) ? Math.min(24, Math.max(1, value)) : fallback
}

/** @param {number|string} min @param {number|string} max @returns {{min: number, max: number}} */
function normalizeLetterRange(min, max) {
  const safeMin = normalizeLetterLimit(String(min), store.defaults.part1MinLetters)
  const safeMax = normalizeLetterLimit(String(max), store.defaults.part1MaxLetters)
  return { min: Math.min(safeMin, safeMax), max: Math.max(safeMin, safeMax) }
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" :aria-label="t('brand.homeAria')" @click.prevent="handleLogoClick">
        <span class="brand-mark"><UIcon name="i-lucide-globe-2" class="size-5.25" /></span>
        <span>Domain<span>Mate</span></span>
      </a>
      <div class="header-actions">
        <div class="topbar-meta"><span class="status-dot" aria-hidden="true"></span>{{ t('topbar.meta') }}</div>
        <USelect v-model="locale" :items="languageItems" :aria-label="t('language.label')" size="sm" class="w-28" />
        <UButton v-if="flags.payments" class="credit-button" :ui="{ base: 'rounded-md' }" @click="paymentDialog?.open()"><span>{{ credits }}</span> {{ t('topbar.credits') }}</UButton>
        <UBadge v-else-if="proUnlocked" color="primary" variant="subtle" size="lg" class="free-tier-badge">{{ t('topbar.proUnlocked') }}</UBadge>
        <UButton v-else class="free-tier-badge" color="neutral" variant="outline" @click="feedbackDialog?.open()">{{ t('topbar.unlockPro') }}</UButton>
      </div>
    </header>

    <main>
      <section class="intro">
        <p class="eyebrow"><UIcon name="i-lucide-sparkles" class="size-3.75" /> {{ t('intro.eyebrow') }}</p>
        <h1>{{ t('intro.title') }}</h1>
        <p>{{ t('intro.subtitle') }}</p>
      </section>

      <div role="search" class="search-workspace">
        <form action="/" method="get" @submit.prevent="submit">
          <div class="brief-grid">
            <div class="field brief-field">
              <label for="brief">{{ t('form.briefLabel') }}</label>
              <div class="input-wrap featured-input">
                <UIcon name="i-lucide-sparkles" class="size-5" />
                <textarea id="brief" v-model="brief" name="brief" rows="3" required minlength="2" maxlength="240" :placeholder="briefPlaceholder" autocomplete="off" @change="store.expandBrief"></textarea>
                <UButton class="expand-button" variant="soft" color="primary" trailing-icon="i-lucide-arrow-down" @click="store.expandBrief">{{ t('form.expand') }}</UButton>
              </div>
            </div>
            <div class="field query-field">
              <label for="effective-query">{{ t('form.queryLabel') }} <span>{{ t('form.queryEditable') }}</span></label>
              <textarea id="effective-query" v-model="effectiveQuery" name="query" rows="9" spellcheck="false"></textarea>
            </div>
          </div>

          <div class="parts-editor">
            <div class="parts-fields">
              <fieldset class="part-field">
                <legend id="name-part1-legend">{{ t('form.part1Label') }}</legend>
                <textarea id="name-part1" v-model="part1" name="part1" rows="3" placeholder="inno inn inter" aria-labelledby="name-part1-legend"></textarea>
                <div class="part-letter-fields">
                  <label for="part1-min-letters">{{ t('form.minLetters') }}<input id="part1-min-letters" v-model.number="part1MinLetters" name="p1min" type="number" min="1" :max="part1MaxLetters" step="1" required @change="syncPartLimit('PART1_MIN_LETTERS', part1MinLetters)" /></label>
                  <label for="part1-max-letters">{{ t('form.maxLetters') }}<input id="part1-max-letters" v-model.number="part1MaxLetters" name="p1max" type="number" :min="part1MinLetters" max="24" step="1" required @change="syncPartLimit('PART1_MAX_LETTERS', part1MaxLetters)" /></label>
                </div>
              </fieldset>
              <fieldset class="part-field">
                <legend id="name-part2-legend">{{ t('form.part2Label') }}</legend>
                <textarea id="name-part2" v-model="part2" name="part2" rows="3" placeholder="tech tec tek" aria-labelledby="name-part2-legend"></textarea>
                <div class="part-letter-fields">
                  <label for="part2-min-letters">{{ t('form.minLetters') }}<input id="part2-min-letters" v-model.number="part2MinLetters" name="p2min" type="number" min="1" :max="part2MaxLetters" step="1" required @change="syncPartLimit('PART2_MIN_LETTERS', part2MinLetters)" /></label>
                  <label for="part2-max-letters">{{ t('form.maxLetters') }}<input id="part2-max-letters" v-model.number="part2MaxLetters" name="p2max" type="number" :min="part2MinLetters" max="24" step="1" required @change="syncPartLimit('PART2_MAX_LETTERS', part2MaxLetters)" /></label>
                </div>
              </fieldset>
            </div>
            <fieldset class="substitution-fieldset">
              <legend>{{ t('form.substitutionsLegend') }}</legend>
              <div class="substitution-options">
                <label v-for="([value, label]) in substitutionOptions" :key="value" :class="{ active: substitutions.includes(value) }">
                  <input v-model="substitutions" type="checkbox" :value="value" @change="syncSubstitutions" />{{ label }}
                </label>
              </div>
              <label class="thesaurus-toggle"><input v-model="useThesaurus" type="checkbox" /><span>{{ t('form.useThesaurus') }}</span><UIcon v-if="enriching" name="i-lucide-loader-circle" class="spin size-3.75" /></label>
            </fieldset>
            <fieldset class="strategy-fieldset">
              <legend>{{ t('form.strategiesLegend') }}</legend>
              <div class="strategy-options">
                <label v-for="([value, labelKey]) in strategyOptions" :key="value" :class="{ active: strategies.includes(value) }">
                  <input v-model="strategies" type="checkbox" :value="value" @change="syncStrategies" />{{ t(labelKey) }}
                </label>
              </div>
            </fieldset>
          </div>

          <div class="options-row compact-options">
            <div class="generation-options">
              <label for="max-syllables">{{ t('form.maxSyllables') }} <input id="max-syllables" v-model.number="maxSyllables" type="number" min="1" max="8" @change="setQueryLine('MAX_SYLLABLES', String(maxSyllables))" /></label>
              <label for="max-consonants">{{ t('form.maxConsonants') }} <input id="max-consonants" v-model.number="maxConsonants" type="number" min="1" max="6" @change="setQueryLine('MAX_CONSONANTS', String(maxConsonants))" /></label>
              <label for="max-length">{{ t('form.maxLength') }} <input id="max-length" v-model.number="maxLength" type="number" min="4" max="24" @change="setQueryLine('MAX_LENGTH', String(maxLength))" /></label>
              <label for="max-names">{{ t('form.baseNames') }} <input id="max-names" v-model.number="maxNames" type="number" min="1" max="400" @change="setQueryLine('MAX_NAMES', String(maxNames))" /></label>
            </div>
            <UButton class="primary-button" type="submit" color="primary" size="xl" :loading="running" :icon="running ? undefined : 'i-lucide-sparkles'">
              {{ running ? t('form.checking') : t('form.generate') }}
            </UButton>
          </div>
        </form>
      </div>

      <section class="results-section" aria-labelledby="results-heading">
        <div class="section-heading">
          <div>
            <h2 id="results-heading">{{ t('results.heading') }}</h2>
            <p v-if="results.length">{{ progressText }}<template v-if="availableCount"> · <strong>{{ t('results.available', { count: availableCount }) }}</strong></template></p>
            <button v-if="resultsLimited" class="free-tier-note" type="button" @click="feedbackDialog?.open()">{{ t('results.limited', { count: store.freeTierResultLimit }) }}</button>
          </div>
          <div class="result-filters">
            <label class="available-filter"><input v-model="availableOnly" type="checkbox" />{{ t('filters.availableOnly') }}</label>
            <UButton v-if="results.length && !running && checkedCount < results.length" class="secondary-button" color="neutral" variant="outline" @click="store.checkAll">{{ t('filters.checkAll') }}</UButton>
          </div>
        </div>

        <div class="results-table" :aria-busy="running">
          <div class="table-head" aria-hidden="true">
            <span>{{ t('table.candidate') }}</span><span>{{ t('table.status') }}</span><span>{{ t('table.google') }}</span><span></span>
          </div>
          <TransitionGroup name="result-row">
          <article v-for="(item, index) in displayedResults" :key="item.id" class="result-row">
            <div class="domain-cell">
              <span class="row-index" aria-hidden="true">{{ index + 1 }}</span>
              <button class="copy-button" type="button" :aria-label="t('actions.copy', { name: item.name })" @click="copyDomain(item)">
                <UIcon :name="item.copied ? 'i-lucide-check' : 'i-lucide-copy'" class="size-4.25" />
              </button>
              <a class="domain-link" :href="domainUrl(item)" target="_blank" rel="noreferrer"><strong>{{ item.brand }}</strong><span>.{{ item.tld }}</span></a>
            </div>
            <div class="status-cell">
              <span v-if="item.status === 'idle'" class="status neutral">{{ t('status.notChecked') }}</span>
              <span v-else-if="item.status === 'checking'" class="status neutral"><UIcon name="i-lucide-loader-circle" class="spin size-3.75" /> {{ t('status.checking') }}</span>
              <span v-else-if="item.availability === 'available'" class="status available" :title="item.availabilityNote || t('status.available')"><UIcon name="i-lucide-check" class="size-3.75" /> {{ t('status.available') }}</span>
              <span v-else-if="item.availability === 'registered'" class="status registered" :title="item.availabilityNote || t('status.registered')">{{ t('status.registered') }}</span>
              <span v-else class="status warning" :title="item.availabilityNote || t('status.unknown')"><UIcon name="i-lucide-circle-alert" class="size-3.75" /> {{ t('status.unknown') }}</span>
            </div>
            <div class="google-cell">
              <template v-if="item.search?.status === 'ok'"><strong>{{ formatCount(item.search.totalResults) }}</strong><span> {{ item.search.countKind === 'returned' ? t('google.matches') : t('google.estimated') }} · {{ item.search.provider }}</span></template>
              <a v-else-if="item.status === 'done'" :href="googleUrl(item)" target="_blank" rel="noreferrer">{{ t('google.open') }} <UIcon name="i-lucide-arrow-up-right" class="size-3.5" /></a>
              <span v-else class="muted">{{ t('google.pending') }}</span>
            </div>
            <div class="actions-cell">
              <div class="rating-stars" role="group" :aria-label="t('rating.groupAria', { name: item.name })">
                <button v-for="n in 5" :key="n" type="button" class="star-button" :class="{ active: ratingOf(item) >= n }" :aria-label="t('rating.starAria', { n, name: item.name })" :aria-pressed="ratingOf(item) >= n" @click="setRating(item, n)"><UIcon name="i-lucide-star" class="size-3.5" /></button>
              </div>
              <button class="icon-button" :class="{ active: item.showPrices }" type="button" :title="t('actions.comparePrices')" :aria-label="t('actions.comparePricesAria', { name: item.name })" :aria-expanded="Boolean(item.showPrices)" @click="item.showPrices = !item.showPrices"><UIcon name="i-lucide-badge-dollar-sign" class="size-4.5" /></button>
              <button v-if="item.status === 'idle' || item.status === 'error'" class="icon-button" type="button" :title="t('actions.checkDomain')" :aria-label="t('actions.checkDomainAria', { name: item.name })" @click="store.checkOne(item)"><UIcon name="i-lucide-search" class="size-4.25" /></button>
              <a class="icon-button" :href="googleUrl(item)" target="_blank" rel="noreferrer" :title="t('actions.searchGoogle')" :aria-label="t('actions.searchGoogleAria', { name: item.name })"><UIcon name="i-lucide-arrow-up-right" class="size-4.5" /></a>
            </div>
            <LazyPriceComparison v-if="item.showPrices" :domain="item.name" />
          </article>
          </TransitionGroup>
          <p v-if="availableOnly && displayedResults.length === 0" class="empty-results">{{ t('results.empty') }}</p>
        </div>
      </section>
    </main>

    <footer><span>{{ t('footer.rdap') }}</span><span>{{ t('footer.vocabularyBy') }} <a href="https://www.datamuse.com/api/" target="_blank" rel="noreferrer">Datamuse</a> · DomainMate · <button type="button" class="footer-link" @click="privacyDialog?.open()">{{ t('footer.privacy') }}</button></span></footer>
    <PaymentDialog v-if="flags.payments" ref="paymentDialog" :credits="credits" @credited="addCredits" />
    <LazyFeatureFlagsPanel v-model="showFlagsPanel" />
    <FeedbackDialog v-if="!proUnlocked" ref="feedbackDialog" />
    <PrivacyPolicyDialog ref="privacyDialog" />
  </div>
</template>
