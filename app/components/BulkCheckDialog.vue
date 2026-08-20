<script setup>
import { ref } from 'vue'
import { t } from '../i18n/index.js'
import { useDomainStore } from '../stores/domain.js'

const store = useDomainStore()
const isOpen = ref(false)
const text = ref('')
const error = ref('')

function open() {
  error.value = ''
  text.value = ''
  isOpen.value = true
}

function submit() {
  const count = store.checkExactDomains(text.value)
  if (!count) { error.value = t('bulkCheck.errors.empty'); return }
  store.checkAll()
  isOpen.value = false
}

defineExpose({ open })
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'payment-dialog-body' }">
    <template #header>
      <div class="dialog-header w-full">
        <div><p class="dialog-eyebrow">{{ t('bulkCheck.eyebrow') }}</p><h2>{{ t('bulkCheck.title') }}</h2></div>
        <UButton :aria-label="t('bulkCheck.close')" icon="i-lucide-x" color="neutral" variant="ghost" @click="isOpen = false" />
      </div>
    </template>
    <template #body>
      <p id="bulk-check-hint" class="flags-hint">{{ t('bulkCheck.hint') }}</p>
      <textarea v-model="text" class="feedback-textarea" rows="8" maxlength="8000" spellcheck="false" :placeholder="t('bulkCheck.placeholder')" :aria-label="t('bulkCheck.title')" aria-describedby="bulk-check-hint"></textarea>
      <p v-if="error" class="payment-error" aria-live="polite">{{ error }}</p>
      <UButton class="primary-button" block :disabled="!text.trim()" @click="submit">{{ t('bulkCheck.submit') }}</UButton>
    </template>
  </UModal>
</template>
