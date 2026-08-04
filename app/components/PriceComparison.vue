<script setup>
import { computed, onMounted, ref } from 'vue'
import { t } from '../i18n/index.js'
import { readCachedPrices, writeCachedPrices } from '../services/domainCache.js'

const props = defineProps({ domain: { type: String, required: true } })
const quotes = ref([])
const loading = ref(true)
const error = ref('')
const pricedQuotes = computed(() => quotes.value
  .filter((quote) => quote.status === 'ok')
  .sort((a, b) => a.currency.localeCompare(b.currency) || a.registration - b.registration))
const unpricedQuotes = computed(() => quotes.value
  .filter((quote) => quote.status !== 'ok')
  .sort((a, b) => a.registrar.localeCompare(b.registrar)))
const preferredQuoteKind = computed(() => (
  pricedQuotes.value.some((quote) => quote.quoteKind === 'exact') ? 'exact' : 'tld-list'
))
const priceStats = computed(() => pricedQuotes.value
  .filter((quote) => quote.quoteKind === preferredQuoteKind.value)
  .reduce((stats, quote) => {
    const current = stats.get(quote.currency) || { count: 0, lowest: Number.POSITIVE_INFINITY }
    current.count += 1
    current.lowest = Math.min(current.lowest, quote.registration)
    stats.set(quote.currency, current)
    return stats
  }, new Map()))

/**
 * Fetch normalized registrar quotes for the selected domain, reusing a
 * recent IndexedDB result unless the user explicitly asks to refresh. The
 * response streams one quote per line so each registrar's price appears as
 * soon as it resolves instead of waiting for every provider to respond.
 * @param {{forceRefresh?: boolean}} [options]
 */
async function loadPrices({ forceRefresh = false } = {}) {
  loading.value = true
  error.value = ''
  quotes.value = []
  if (!forceRefresh) {
    const cached = await readCachedPrices(props.domain)
    if (cached) { quotes.value = cached.quotes; loading.value = false; return }
  }
  try {
    const response = await fetch(`/api/registrars/compare?domain=${encodeURIComponent(props.domain)}`)
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || t('prices.failed'))
    const collected = []
    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          if (!line.trim()) continue
          const message = JSON.parse(line)
          if (message.quote) { collected.push(message.quote); quotes.value = [...collected]; loading.value = false }
        }
      }
    } else {
      const data = await response.json()
      collected.push(...(Array.isArray(data.quotes) ? data.quotes : []))
      quotes.value = collected
    }
    await writeCachedPrices(props.domain, collected)
  } catch (reason) { error.value = reason instanceof Error && reason.message !== 'Failed to fetch' ? reason.message : t('prices.failed') }
  finally { loading.value = false }
}

/** @param {number|undefined} value @param {string|undefined} currency */
function formatPrice(value, currency) {
  if (!Number.isFinite(value) || !currency) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

/** @param {{currency?: string, registration?: number, quoteKind?: 'exact'|'tld-list'}} quote */
function isLowest(quote) {
  if (quote.quoteKind !== preferredQuoteKind.value) return false
  const stats = priceStats.value.get(quote.currency)
  return Boolean(stats && stats.count > 1 && quote.registration === stats.lowest)
}

/** @param {string} status */
function statusText(status) {
  return t(`prices.status.${status}`)
}

onMounted(loadPrices)
</script>

<template>
  <section class="price-comparison" :aria-busy="loading" :aria-label="t('prices.title')">
    <div class="price-title">
      <UIcon name="i-lucide-badge-dollar-sign" class="size-4.5" /><strong>{{ t('prices.title') }}</strong><span>{{ domain }}</span>
      <button type="button" class="icon-button price-refresh" :disabled="loading" :title="t('prices.refresh')" :aria-label="t('prices.refreshAria', { name: domain })" @click="loadPrices({ forceRefresh: true })"><UIcon name="i-lucide-refresh-cw" class="size-3.75" :class="{ spin: loading }" /></button>
    </div>
    <div v-if="loading" class="price-loading"><UIcon name="i-lucide-loader-circle" class="spin size-4.5" />{{ t('prices.loading') }}</div>
    <p v-else-if="error" class="price-message"><UIcon name="i-lucide-circle-alert" class="size-4" />{{ error }}</p>
    <template v-else>
      <div v-if="quotes.length" class="quote-table" role="table" :aria-label="t('prices.title')">
        <div class="quote-head" role="row"><span role="columnheader">{{ t('prices.registrar') }}</span><span role="columnheader">{{ t('prices.firstYear') }}</span><span role="columnheader">{{ t('prices.renewal') }}</span><span role="columnheader"></span></div>
        <div v-for="quote in pricedQuotes" :key="quote.registrar" class="quote-row" role="row">
          <div role="cell"><strong>{{ quote.registrar }}</strong><small>{{ quote.quoteKind === 'exact' ? t('prices.liveQuote') : t('prices.listPrice') }}<template v-if="quote.premium"> · {{ t('prices.premium') }}</template></small></div>
          <span role="cell"><b v-if="isLowest(quote)" class="best-price">{{ t('prices.lowest') }}</b>{{ formatPrice(quote.registration, quote.currency) }}</span>
          <span role="cell">{{ formatPrice(quote.renewal, quote.currency) }}</span>
          <span class="quote-link-cell" role="cell"><a :href="quote.url" target="_blank" rel="noreferrer" :aria-label="t('prices.openRegistrarAria', { registrar: quote.registrar, name: domain })"><UIcon name="i-lucide-external-link" class="size-4" /></a></span>
        </div>
        <div v-for="quote in unpricedQuotes" :key="quote.registrar" class="quote-row quote-row-unpriced" role="row">
          <div role="cell"><strong>{{ quote.registrar }}</strong><small :title="quote.message">{{ statusText(quote.status) }}<template v-if="quote.status === 'error' && quote.message"> · {{ quote.message }}</template></small></div>
          <span role="cell">—</span>
          <span role="cell">—</span>
          <span class="quote-link-cell" role="cell"><a :href="quote.url" target="_blank" rel="noreferrer" :aria-label="t('prices.openRegistrarAria', { registrar: quote.registrar, name: domain })"><UIcon name="i-lucide-external-link" class="size-4" /></a></span>
        </div>
      </div>
      <p v-if="quotes.length === 0" class="price-message">{{ t('prices.none') }}</p>
      <p class="provider-note">{{ t('prices.confirm') }}</p>
    </template>
  </section>
</template>
