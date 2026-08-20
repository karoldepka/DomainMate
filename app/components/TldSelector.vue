<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { t } from '../i18n/index.js'

const props = defineProps({ modelValue: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const search = ref('')
const catalog = ref([])
const loading = ref(false)

/** Familiar public suffixes that sit below a country-code TLD rather than IANA's root zone. */
const secondLevelDomains = ['ac.uk', 'co.uk', 'com.au', 'com.br', 'com.cn', 'com.hk', 'com.mx', 'co.in', 'co.jp', 'co.nz', 'co.za', 'com.sg', 'com.tr', 'gov.uk', 'net.au', 'org.au', 'org.uk']
const selected = ref(parseTlds(props.modelValue))
const normalizedSearch = computed(() => search.value.trim().toLowerCase().replace(/^\.+/, ''))
const allOptions = computed(() => [...new Set([...catalog.value, ...secondLevelDomains])].sort((left, right) => left.localeCompare(right)))
const matchingOptions = computed(() => {
  const options = normalizedSearch.value ? allOptions.value.filter(tld => tld.includes(normalizedSearch.value)) : allOptions.value.slice(0, 80)
  return options.filter(tld => !secondLevelDomains.includes(tld))
})
const matchingSecondLevelDomains = computed(() => secondLevelDomains.filter(tld => !normalizedSearch.value || tld.includes(normalizedSearch.value)))
const allMatchesSelected = computed(() => {
  const matches = [...matchingOptions.value, ...matchingSecondLevelDomains.value]
  return matches.length > 0 && matches.every(tld => selected.value.includes(tld))
})

watch(() => props.modelValue, value => { selected.value = parseTlds(value) })
watch(selected, value => emit('update:modelValue', value.map(tld => `.${tld}`).join(' ')), { deep: true })

async function loadCatalog() {
  loading.value = true
  try {
    const data = await $fetch('/api/tlds')
    catalog.value = Array.isArray(data.tlds) ? data.tlds : []
  } catch { catalog.value = [] } finally { loading.value = false }
}

function toggleMatches() {
  const matches = [...matchingOptions.value, ...matchingSecondLevelDomains.value]
  const next = new Set(selected.value)
  if (allMatchesSelected.value) matches.forEach(tld => next.delete(tld))
  else matches.forEach(tld => next.add(tld))
  selected.value = [...next].sort((left, right) => left.localeCompare(right))
}

/** @param {string} value */
function parseTlds(value) {
  return [...new Set(String(value).split(/[\s,]+/).map(normalizeTld).filter(Boolean))]
}

/** @param {string} value */
function normalizeTld(value) {
  const tld = String(value).trim().toLowerCase().replace(/^\.+/, '')
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tld) ? tld : ''
}

onMounted(loadCatalog)
</script>

<template>
  <fieldset class="tld-selector">
    <legend>{{ t('form.tldLabel') }}</legend>
    <div class="tld-toolbar">
      <input v-model="search" type="search" class="tld-search" :placeholder="t('form.tldSearch')" :aria-label="t('form.tldSearch')" />
      <button type="button" class="suffix-toggle-all" :disabled="loading || (!matchingOptions.length && !matchingSecondLevelDomains.length)" @click="toggleMatches">{{ allMatchesSelected ? t('form.suffixesClearAll') : t('form.tldAll') }}</button>
    </div>
    <p class="tld-summary" aria-live="polite">{{ selected.length }} {{ t('form.tldSelected') }}<template v-if="loading"> · {{ t('form.tldLoading') }}</template></p>
    <div v-if="matchingSecondLevelDomains.length" class="tld-group">
      <p>{{ t('form.tldSecondLevel') }}</p>
      <div class="suffix-options">
        <label v-for="tld in matchingSecondLevelDomains" :key="tld" :class="{ active: selected.includes(tld) }"><input v-model="selected" type="checkbox" :value="tld" />.{{ tld }}</label>
      </div>
    </div>
    <div class="tld-group">
      <p>{{ t('form.tldAll') }}</p>
      <div class="suffix-options">
        <label v-for="tld in matchingOptions" :key="tld" :class="{ active: selected.includes(tld) }"><input v-model="selected" type="checkbox" :value="tld" />.{{ tld }}</label>
      </div>
      <p v-if="!matchingOptions.length && !matchingSecondLevelDomains.length" class="tld-summary">{{ t('form.tldNoMatch') }}</p>
    </div>
  </fieldset>
</template>
