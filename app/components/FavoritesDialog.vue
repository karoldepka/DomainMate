<script setup>
import { computed, ref } from 'vue'
import { t } from '../i18n/index.js'
import { useDomainStore } from '../stores/domain.js'

const props = defineProps({ favorites: { type: Map, required: true } })
const emit = defineEmits(['remove'])
const store = useDomainStore()
const isOpen = ref(false)
const checks = ref(new Map())
const recheckingAll = ref(false)

const entries = computed(() => [...props.favorites.entries()]
  .filter(([, record]) => record.rating > 0)
  .sort((a, b) => b[1].rating - a[1].rating || b[1].updatedAt - a[1].updatedAt)
  .map(([domain, record]) => ({ domain, ...record, ...(checks.value.get(domain) || { status: 'idle', availability: null }) })))

const availableCount = computed(() => entries.value.filter((entry) => entry.availability === 'available').length)

function open() { isOpen.value = true }

/** Reuse the store's generic single-domain checker; favorites live outside the results list. */
async function recheckOne(domain) {
  const item = { name: domain, status: 'checking', availability: null, availabilityNote: '' }
  checks.value.set(domain, item)
  checks.value = new Map(checks.value)
  await store.checkOne(item)
  checks.value.set(domain, item)
  checks.value = new Map(checks.value)
}

/** Small batches with a short pause between them, matching the results table's own recheck pacing. */
async function recheckAll() {
  recheckingAll.value = true
  const domains = entries.value.map((entry) => entry.domain)
  for (let index = 0; index < domains.length; index += 4) {
    await Promise.all(domains.slice(index, index + 4).map(recheckOne))
    if (index + 4 < domains.length) await new Promise((resolve) => setTimeout(resolve, 180))
  }
  recheckingAll.value = false
}

/** @param {string} domain */
function googleUrl(domain) { return `https://www.google.com/search?q=${encodeURIComponent(`"${domain}"`)}` }

defineExpose({ open })
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'payment-dialog-body' }">
    <template #header>
      <div class="dialog-header w-full">
        <div><p class="dialog-eyebrow">{{ t('favorites.eyebrow') }}</p><h2>{{ t('favorites.title') }}</h2></div>
        <UButton :aria-label="t('favorites.close')" icon="i-lucide-x" color="neutral" variant="ghost" @click="isOpen = false" />
      </div>
    </template>
    <template #body>
      <p v-if="!entries.length" class="flags-hint">{{ t('favorites.empty') }}</p>
      <template v-else>
        <p v-if="availableCount" class="feedback-success"><UIcon name="i-lucide-party-popper" class="size-4.25" />{{ t('favorites.dropped', { count: availableCount }) }}</p>
        <UButton class="secondary-button favorites-recheck-all" color="neutral" variant="outline" :loading="recheckingAll" @click="recheckAll">{{ recheckingAll ? t('favorites.recheckingAll') : t('favorites.recheckAll') }}</UButton>
        <ul class="favorites-list">
          <li v-for="entry in entries" :key="entry.domain" class="favorite-row">
            <div class="favorite-main">
              <a :href="`https://${entry.domain}`" target="_blank" rel="noreferrer">{{ entry.domain }}</a>
              <p v-if="entry.comment" class="favorite-comment">{{ entry.comment }}</p>
            </div>
            <span v-if="entry.status === 'checking'" class="status neutral"><UIcon name="i-lucide-loader-circle" class="spin size-3.75" /> {{ t('status.checking') }}</span>
            <span v-else-if="entry.availability === 'available'" class="status available"><UIcon name="i-lucide-check" class="size-3.75" /> {{ t('status.available') }}</span>
            <span v-else-if="entry.availability === 'registered'" class="status registered">{{ t('status.registered') }}</span>
            <span v-else-if="entry.availability === 'unknown'" class="status warning">{{ t('status.unknown') }}</span>
            <span v-else class="status neutral">{{ t('status.notChecked') }}</span>
            <div class="favorite-actions">
              <button class="icon-button" type="button" :title="t('favorites.recheckAria', { name: entry.domain })" :aria-label="t('favorites.recheckAria', { name: entry.domain })" @click="recheckOne(entry.domain)"><UIcon name="i-lucide-search" class="size-4.25" /></button>
              <a class="icon-button" :href="googleUrl(entry.domain)" target="_blank" rel="noreferrer" :title="t('actions.searchGoogle')"><UIcon name="i-lucide-arrow-up-right" class="size-4.5" /></a>
              <button class="icon-button" type="button" :title="t('favorites.removeAria', { name: entry.domain })" :aria-label="t('favorites.removeAria', { name: entry.domain })" @click="emit('remove', entry.domain)"><UIcon name="i-lucide-star-off" class="size-4.25" /></button>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </UModal>
</template>
