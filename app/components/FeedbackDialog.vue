<script setup>
import { ref } from 'vue'
import { t } from '../i18n/index.js'
import { getClientId } from '../services/favorites.js'
import { flags } from '../featureFlags.js'
import { track } from '../services/analytics.js'

const emit = defineEmits(['unlocked'])
const isOpen = ref(false)
const message = ref('')
const submitting = ref(false)
const error = ref('')
const done = ref(false)

function open() {
  error.value = ''
  done.value = false
  message.value = ''
  isOpen.value = true
}

async function submit() {
  if (!message.value.trim()) return
  submitting.value = true
  error.value = ''
  try {
    const clientId = await getClientId()
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, message: message.value.trim() }),
    })
    if (!response.ok) throw new Error(t('feedback.errors.submitFailed'))
    flags.searchResults = true
    flags.aiSuggestions = true
    flags.favoritesSync = true
    track('feedback_submitted')
    done.value = true
    emit('unlocked')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : t('feedback.errors.submitFailed')
  } finally {
    submitting.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'payment-dialog-body' }">
    <template #header>
      <div class="dialog-header w-full">
        <div><p class="dialog-eyebrow">{{ t('feedback.eyebrow') }}</p><h2>{{ t('feedback.title') }}</h2></div>
        <UButton :aria-label="t('feedback.close')" icon="i-lucide-x" color="neutral" variant="ghost" @click="isOpen = false" />
      </div>
    </template>
    <template #body>
      <template v-if="done">
        <p class="feedback-success"><UIcon name="i-lucide-check" class="size-4.25" /> {{ t('feedback.success') }}</p>
      </template>
      <template v-else>
        <p class="flags-hint">{{ t('feedback.hint') }}</p>
        <textarea v-model="message" class="feedback-textarea" rows="5" maxlength="4000" :placeholder="t('feedback.placeholder')"></textarea>
        <p v-if="error" class="payment-error" aria-live="polite">{{ error }}</p>
        <UButton class="primary-button" block :loading="submitting" :disabled="!message.trim()" @click="submit">
          {{ submitting ? t('feedback.submitting') : t('feedback.submit') }}
        </UButton>
      </template>
    </template>
  </UModal>
</template>
