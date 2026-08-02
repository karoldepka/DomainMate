<script setup>
import { computed, onMounted, ref } from 'vue'
import { BadgeDollarSign, CircleAlert, ExternalLink, LoaderCircle } from 'lucide-vue-next'
import { t } from '../i18n'
import { getRegistrarLinks } from '../services/registrarLinks'

const props = defineProps({ domain: { type: String, required: true } })
const quotes = ref([])
const loading = ref(true)
const error = ref('')
const pricedQuotes = computed(() => quotes.value.filter((quote) => quote.status === 'ok').sort((a, b) => a.registration - b.registration))
const unconfiguredCount = computed(() => quotes.value.filter((quote) => quote.status === 'not-configured').length)
const registrarLinks = computed(() => getRegistrarLinks(props.domain))

/** Fetch normalized registrar quotes for the selected domain. */
async function loadPrices() {
  try {
    const response = await fetch(`/api/registrars/compare?domain=${encodeURIComponent(props.domain)}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || t('prices.failed'))
    quotes.value = data.quotes || []
  } catch (reason) { error.value = reason instanceof Error ? reason.message : t('prices.failed') }
  finally { loading.value = false }
}

/** @param {number|undefined} value @param {string|undefined} currency */
function formatPrice(value, currency) {
  if (!Number.isFinite(value) || !currency) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

onMounted(loadPrices)
</script>

<template>
  <section class="price-comparison" :aria-busy="loading" :aria-label="t('prices.title')">
    <div class="price-title"><BadgeDollarSign :size="18" /><strong>{{ t('prices.title') }}</strong><span>{{ domain }}</span></div>
    <div v-if="loading" class="price-loading"><LoaderCircle class="spin" :size="18" />{{ t('prices.loading') }}</div>
    <p v-else-if="error" class="price-message"><CircleAlert :size="16" />{{ error }}</p>
    <template v-else>
      <div class="quote-head" aria-hidden="true"><span>{{ t('prices.registrar') }}</span><span>{{ t('prices.firstYear') }}</span><span>{{ t('prices.renewal') }}</span><span></span></div>
      <div v-for="(quote, index) in pricedQuotes" :key="quote.registrar" class="quote-row">
        <div><strong>{{ quote.registrar }}</strong><small>{{ quote.quoteKind === 'exact' ? t('prices.liveQuote') : t('prices.listPrice') }}<template v-if="quote.premium"> · {{ t('prices.premium') }}</template></small></div>
        <span><b v-if="index === 0" class="best-price">{{ t('prices.lowest') }}</b>{{ formatPrice(quote.registration, quote.currency) }}</span>
        <span>{{ formatPrice(quote.renewal, quote.currency) }}</span>
        <a :href="quote.url" target="_blank" rel="noreferrer" :aria-label="`${quote.registrar}: ${domain}`"><ExternalLink :size="16" /></a>
      </div>
      <p v-if="pricedQuotes.length === 0" class="price-message">{{ t('prices.none') }}</p>
      <p v-if="unconfiguredCount" class="provider-note">{{ t('prices.moreProviders', { count: unconfiguredCount }) }}</p>
      <p class="provider-note">{{ t('prices.confirm') }}</p>
    </template>
    <div class="registrar-links">
      <div class="registrar-links-title">
        <strong>{{ t('prices.popularRegistrars') }}</strong>
        <span>{{ t('prices.directSearches') }}</span>
      </div>
      <ul class="registrar-link-grid" role="list">
        <li v-for="registrar in registrarLinks" :key="registrar.name">
          <a :href="registrar.url" target="_blank" rel="noopener noreferrer" :aria-label="t('prices.openRegistrarAria', { registrar: registrar.name, name: domain })">
            <span>{{ registrar.name }}</span><ExternalLink :size="15" aria-hidden="true" />
          </a>
        </li>
      </ul>
    </div>
  </section>
</template>
