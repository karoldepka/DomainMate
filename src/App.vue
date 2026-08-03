<script setup>
import { computed, defineAsyncComponent, onMounted, ref, useTemplateRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ArrowDown, ArrowUpRight, BadgeDollarSign, Check, CircleAlert, Copy, Globe2, LoaderCircle, Search as SearchIcon, Sparkles, Star } from 'lucide-vue-next'
import { useDomainStore } from './stores/domain'
import PaymentDialog from './components/PaymentDialog.vue'
import { loadAndSyncFavorites, saveRating } from './services/favorites'
import { locale, locales, t } from './i18n'

const PriceComparison = defineAsyncComponent(() => import('./components/PriceComparison.vue'))

const store = useDomainStore()
const { brief, effectiveQuery, keywords, maxSyllables, maxConsonants, maxLength, maxNames, substitutions, strategies, useThesaurus, enriching, results, running, checkedCount, availableCount } = storeToRefs(store)
const progressText = computed(() => t('results.progress', { checked: checkedCount.value, total: results.value.length }))
const paymentDialog = useTemplateRef('paymentDialog')
const credits = ref(Number(localStorage.getItem('domainmate.credits') || 5))
const availableOnly = ref(true)
const sortMode = ref('rating')
const favorites = ref(new Map())
const displayedResults = computed(() => {
  const items = availableOnly.value ? results.value.filter((item) => item.availability !== 'registered') : [...results.value]
  if (sortMode.value === 'shortest') return items.sort((a, b) => ratingRank(a) - ratingRank(b) || availabilityRank(a) - availabilityRank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name))
  if (sortMode.value === 'longest') return items.sort((a, b) => ratingRank(a) - ratingRank(b) || availabilityRank(a) - availabilityRank(b) || b.name.length - a.name.length || a.name.localeCompare(b.name))
  if (sortMode.value === 'available') return items.sort((a, b) => ratingRank(a) - ratingRank(b) || availabilityRank(a) - availabilityRank(b))
  return items.sort((a, b) => ratingRank(a) - ratingRank(b))
})
const iParts = computed({ get: () => getQueryLine('I'), set: (value) => setQueryLine('I', value) })
const tParts = computed({ get: () => getQueryLine('T'), set: (value) => setQueryLine('T', value) })
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
  restoreQueryParams()
  store.generate()
  syncQueryParams()
  favorites.value = await loadAndSyncFavorites()
})

watch([brief, effectiveQuery, maxSyllables, maxConsonants, maxLength, maxNames, availableOnly, useThesaurus, sortMode], syncQueryParams)

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

/** @param {{availability: string|null}} item */
function availabilityRank(item) {
  if (item.availability === 'available') return 0
  if (item.availability === 'registered') return 2
  return 1
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
  return line?.split(':').slice(1).join(':').trim() || ''
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

/** Restore a shareable naming workspace from its URL. */
function restoreQueryParams() {
  const params = new URLSearchParams(window.location.search)
  const legacyGeneratedUrl = params.has('query')
  if (params.has('brief')) brief.value = params.get('brief') || brief.value
  if (params.has('syllables')) maxSyllables.value = Number(params.get('syllables')) || 3
  if (params.has('consonants')) maxConsonants.value = Number(params.get('consonants')) || 2
  if (params.has('length')) maxLength.value = Number(params.get('length')) || 'innotek'.length
  if (params.has('maxNames')) maxNames.value = Number(params.get('maxNames')) || 150
  if (params.has('available')) availableOnly.value = params.get('available') === '1'
  sortMode.value = params.get('sort') || 'rating'
  store.expandBrief()
  if (params.has('i')) setQueryLine('I', params.get('i') || '')
  if (params.has('t')) setQueryLine('T', params.get('t') || '')
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
  setOverride(params, 'brief', brief.value, store.defaults.brief)
  setOverride(params, 'i', iParts.value, baseline.i)
  setOverride(params, 't', tParts.value, baseline.t)
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
  if (sortMode.value !== 'rating') params.set('sort', sortMode.value)
  const query = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

/** @param {URLSearchParams} params @param {string} key @param {string} value @param {string} baseline */
function setOverride(params, key, value, baseline) {
  if (value.trim() !== baseline.trim()) params.set(key, value)
}

/** @param {string} value */
function normalizeList(value) { return value.split(/[\s,]+/).filter(Boolean).join(',') }
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="DomainMate home">
        <span class="brand-mark"><Globe2 :size="21" stroke-width="2.2" /></span>
        <span>Domain<span>Mate</span></span>
      </a>
      <div class="header-actions">
        <div class="topbar-meta"><span class="status-dot" aria-hidden="true"></span>{{ t('topbar.meta') }}</div>
        <label class="language-select" :aria-label="t('language.label')">
          <select v-model="locale">
            <option v-for="item in locales" :key="item.code" :value="item.code">{{ item.label }}</option>
          </select>
        </label>
        <button class="credit-button" type="button" @click="paymentDialog?.open()"><span>{{ credits }}</span> {{ t('topbar.credits') }}</button>
      </div>
    </header>

    <main>
      <section class="intro">
        <p class="eyebrow"><Sparkles :size="15" /> {{ t('intro.eyebrow') }}</p>
        <h1>{{ t('intro.title') }}</h1>
        <p>{{ t('intro.subtitle') }}</p>
      </section>

      <search class="search-workspace">
        <form action="/" method="get" @submit.prevent="submit">
          <div class="brief-grid">
            <div class="field brief-field">
              <label for="brief">{{ t('form.briefLabel') }}</label>
              <div class="input-wrap featured-input">
                <Sparkles :size="20" />
                <input id="brief" v-model.trim="brief" name="brief" type="text" required minlength="2" maxlength="240" placeholder="inno Inter tech tek .dev .ai .com" autocomplete="off" @change="store.expandBrief" />
                <button class="expand-button" type="button" @click="store.expandBrief">{{ t('form.expand') }} <ArrowDown :size="16" /></button>
              </div>
            </div>
            <div class="field query-field">
              <label for="effective-query">{{ t('form.queryLabel') }} <span>{{ t('form.queryEditable') }}</span></label>
              <textarea id="effective-query" v-model="effectiveQuery" name="query" rows="9" spellcheck="false"></textarea>
            </div>
          </div>

          <div class="parts-editor">
            <div class="parts-fields">
              <div class="field"><label for="i-parts">{{ t('form.iLabel') }}</label><input id="i-parts" v-model="iParts" type="text" placeholder="inno, inn, inter" /></div>
              <div class="field"><label for="t-parts">{{ t('form.tLabel') }}</label><input id="t-parts" v-model="tParts" type="text" placeholder="tech, tec, tek" /></div>
            </div>
            <fieldset class="substitution-fieldset">
              <legend>{{ t('form.substitutionsLegend') }}</legend>
              <div class="substitution-options">
                <label v-for="([value, label]) in substitutionOptions" :key="value" :class="{ active: substitutions.includes(value) }">
                  <input v-model="substitutions" type="checkbox" :value="value" @change="syncSubstitutions" />{{ label }}
                </label>
              </div>
              <label class="thesaurus-toggle"><input v-model="useThesaurus" type="checkbox" /><span>{{ t('form.useThesaurus') }}</span><LoaderCircle v-if="enriching" class="spin" :size="15" /></label>
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
            <button class="primary-button" type="submit" :disabled="running">
              <LoaderCircle v-if="running" class="spin" :size="19" />
              <Sparkles v-else :size="19" />
              {{ running ? t('form.checking') : t('form.generate') }}
            </button>
          </div>
        </form>
      </search>

      <section class="results-section" aria-labelledby="results-heading">
        <div class="section-heading">
          <div>
            <h2 id="results-heading">{{ t('results.heading') }}</h2>
            <p v-if="results.length">{{ progressText }}<template v-if="availableCount"> · <strong>{{ t('results.available', { count: availableCount }) }}</strong></template></p>
          </div>
          <div class="result-filters">
            <select v-model="sortMode" class="sort-select" :aria-label="t('results.sortAria')">
              <option value="rating">{{ t('sort.rating') }}</option>
              <option value="available">{{ t('sort.available') }}</option>
              <option value="shortest">{{ t('sort.shortest') }}</option>
              <option value="longest">{{ t('sort.longest') }}</option>
            </select>
            <label class="available-filter"><input v-model="availableOnly" type="checkbox" />{{ t('filters.availableOnly') }}</label>
            <button v-if="results.length && !running && checkedCount < results.length" class="secondary-button" type="button" @click="store.checkAll">{{ t('filters.checkAll') }}</button>
          </div>
        </div>

        <div class="results-table" :aria-busy="running">
          <div class="table-head" aria-hidden="true">
            <span>{{ t('table.candidate') }}</span><span>{{ t('table.status') }}</span><span>{{ t('table.google') }}</span><span></span>
          </div>
          <article v-for="item in displayedResults" :key="item.id" class="result-row">
            <div class="domain-cell">
              <button class="copy-button" type="button" :aria-label="t('actions.copy', { name: item.name })" @click="copyDomain(item)">
                <Check v-if="item.copied" :size="17" />
                <Copy v-else :size="17" />
              </button>
              <a class="domain-link" :href="domainUrl(item)" target="_blank" rel="noreferrer"><strong>{{ item.brand }}</strong><span>.{{ item.tld }}</span></a>
            </div>
            <div class="status-cell">
              <span v-if="item.status === 'idle'" class="status neutral">{{ t('status.notChecked') }}</span>
              <span v-else-if="item.status === 'checking'" class="status neutral"><LoaderCircle class="spin" :size="15" /> {{ t('status.checking') }}</span>
              <span v-else-if="item.availability === 'available'" class="status available" :title="item.availabilityNote || t('status.available')"><Check :size="15" /> {{ t('status.available') }}</span>
              <span v-else-if="item.availability === 'registered'" class="status registered" :title="item.availabilityNote || t('status.registered')">{{ t('status.registered') }}</span>
              <span v-else class="status warning" :title="item.availabilityNote || t('status.unknown')"><CircleAlert :size="15" /> {{ t('status.unknown') }}</span>
            </div>
            <div class="google-cell">
              <template v-if="item.search?.status === 'ok'"><strong>{{ formatCount(item.search.totalResults) }}</strong><span> {{ item.search.countKind === 'returned' ? t('google.matches') : t('google.estimated') }} · {{ item.search.provider }}</span></template>
              <a v-else-if="item.status === 'done'" :href="googleUrl(item)" target="_blank" rel="noreferrer">{{ t('google.open') }} <ArrowUpRight :size="14" /></a>
              <span v-else class="muted">{{ t('google.pending') }}</span>
            </div>
            <div class="actions-cell">
              <div class="rating-stars" role="group" :aria-label="t('rating.groupAria', { name: item.name })">
                <button v-for="n in 5" :key="n" type="button" class="star-button" :class="{ active: ratingOf(item) >= n }" :aria-label="t('rating.starAria', { n, name: item.name })" :aria-pressed="ratingOf(item) >= n" @click="setRating(item, n)"><Star :size="14" :fill="ratingOf(item) >= n ? 'currentColor' : 'none'" /></button>
              </div>
              <button class="icon-button" :class="{ active: item.showPrices }" type="button" :title="t('actions.comparePrices')" :aria-label="t('actions.comparePricesAria', { name: item.name })" :aria-expanded="Boolean(item.showPrices)" @click="item.showPrices = !item.showPrices"><BadgeDollarSign :size="18" /></button>
              <button v-if="item.status === 'idle' || item.status === 'error'" class="icon-button" type="button" :title="t('actions.checkDomain')" :aria-label="t('actions.checkDomainAria', { name: item.name })" @click="store.checkOne(item)"><SearchIcon :size="17" /></button>
              <a class="icon-button" :href="googleUrl(item)" target="_blank" rel="noreferrer" :title="t('actions.searchGoogle')" :aria-label="t('actions.searchGoogleAria', { name: item.name })"><ArrowUpRight :size="18" /></a>
            </div>
            <PriceComparison v-if="item.showPrices" :domain="item.name" />
          </article>
          <p v-if="availableOnly && displayedResults.length === 0" class="empty-results">{{ t('results.empty') }}</p>
        </div>
      </section>
    </main>

    <footer><span>{{ t('footer.rdap') }}</span><span>{{ t('footer.vocabularyBy') }} <a href="https://www.datamuse.com/api/" target="_blank" rel="noreferrer">Datamuse</a> · DomainMate</span></footer>
    <PaymentDialog ref="paymentDialog" :credits="credits" @credited="addCredits" />
  </div>
</template>
