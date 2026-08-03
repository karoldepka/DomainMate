<script setup>
import { ref, useTemplateRef } from 'vue'
import { Check, X } from 'lucide-vue-next'
import { t } from '../i18n'
import { getClientId } from '../services/favorites'
import { flags } from '../featureFlags'

const emit = defineEmits(['unlocked'])
const dialog = useTemplateRef('feedbackDialog')
const message = ref('')
const submitting = ref(false)
const error = ref('')
const done = ref(false)

function open() {
  error.value = ''
  done.value = false
  message.value = ''
  dialog.value?.showModal()
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
    flags.priceComparison = true
    flags.favoritesSync = true
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
  <dialog ref="feedbackDialog" class="payment-dialog" closedby="any">
    <div class="dialog-header">
      <div><p class="dialog-eyebrow">{{ t('feedback.eyebrow') }}</p><h2>{{ t('feedback.title') }}</h2></div>
      <button type="button" class="icon-button" :aria-label="t('feedback.close')" @click="dialog?.close()"><X :size="19" /></button>
    </div>
    <template v-if="done">
      <p class="feedback-success"><Check :size="17" /> {{ t('feedback.success') }}</p>
    </template>
    <template v-else>
      <p class="flags-hint">{{ t('feedback.hint') }}</p>
      <textarea v-model="message" class="feedback-textarea" rows="5" maxlength="4000" :placeholder="t('feedback.placeholder')"></textarea>
      <p v-if="error" class="payment-error" aria-live="polite">{{ error }}</p>
      <button class="primary-button feedback-submit" type="button" :disabled="submitting || !message.trim()" @click="submit">
        {{ submitting ? t('feedback.submitting') : t('feedback.submit') }}
      </button>
    </template>
  </dialog>
</template>
