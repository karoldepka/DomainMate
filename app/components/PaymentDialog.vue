<script setup>
import { onMounted, ref } from 'vue'
import { t } from '../i18n/index.js'
import { track } from '../services/analytics.js'

defineProps({ credits: { type: Number, required: true } })
const emit = defineEmits(['credited'])
const isOpen = ref(false)
const packs = ref([])
const configured = ref(false)
const loading = ref('')
const error = ref('')
const paymentNotice = ref('')

/** Open the modal and fetch current server-owned pricing. */
async function open() {
  error.value = ''
  isOpen.value = true
  try {
    const response = await fetch('/api/payments/packs')
    const data = await response.json()
    packs.value = data.packs || []
    configured.value = data.configured
  } catch { error.value = t('payment.errors.loadFailed') }
}

/** @param {{id: string, label: string}} pack */
function packLabel(pack) { return t(`payment.pack.${pack.id}`) }

/** @param {{id: string}} pack */
async function checkout(pack) {
  loading.value = pack.id
  error.value = ''
  try {
    const response = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: pack.id }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || t('payment.errors.checkoutFailed'))
    track('checkout_started', { credit_pack: pack.id })
    window.location.assign(data.url)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : t('payment.errors.checkoutFailed')
    loading.value = ''
  }
}

/** Verify Stripe's return value before crediting this browser once. */
async function verifyPaymentReturn() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('payment') === 'cancelled') paymentNotice.value = t('payment.notice.cancelled')
  const sessionId = params.get('session_id')
  if (params.get('payment') !== 'success' || !sessionId) return
  const claimed = JSON.parse(localStorage.getItem('domainmate.claimedSessions') || '[]')
  if (claimed.includes(sessionId)) return clearPaymentQuery()
  try {
    const response = await fetch(`/api/payments/verify?session_id=${encodeURIComponent(sessionId)}`)
    const data = await response.json()
    if (response.ok && data.paid && data.credits > 0) {
      localStorage.setItem('domainmate.claimedSessions', JSON.stringify([...claimed, sessionId]))
      emit('credited', data.credits)
      track('payment_completed', { credits: data.credits })
      paymentNotice.value = t('payment.notice.credited', { credits: data.credits })
    } else paymentNotice.value = t('payment.notice.notCompleted')
  } catch { paymentNotice.value = t('payment.notice.verifyFailed') }
  clearPaymentQuery()
}

/** Remove Stripe return parameters without reloading the app. */
function clearPaymentQuery() {
  const params = new URLSearchParams(window.location.search)
  params.delete('payment')
  params.delete('session_id')
  const query = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

onMounted(verifyPaymentReturn)
defineExpose({ open })
</script>

<template>
  <p v-if="paymentNotice" class="payment-toast" aria-live="polite"><UIcon name="i-lucide-check" class="size-4" />{{ paymentNotice }}</p>
  <UModal v-model:open="isOpen" :ui="{ content: 'payment-dialog-body' }">
    <template #header>
      <div class="dialog-header w-full">
        <div><p class="dialog-eyebrow">{{ t('payment.eyebrow') }}</p><h2>{{ t('payment.title') }}</h2></div>
        <UButton :aria-label="t('payment.close')" icon="i-lucide-x" color="neutral" variant="ghost" @click="isOpen = false" />
      </div>
    </template>
    <template #body>
      <div class="balance-line"><span>{{ t('payment.balance') }}</span><strong>{{ credits }} {{ t('payment.creditsLabel') }}</strong></div>
      <div class="pack-grid">
        <button v-for="pack in packs" :key="pack.id" type="button" class="pack-option" :disabled="loading || !configured" @click="checkout(pack)">
          <span class="pack-label">{{ packLabel(pack) }}</span>
          <strong>{{ pack.credits }} <small>{{ t('payment.creditsLabel') }}</small></strong>
          <span>{{ (pack.amount / 100).toFixed(2) }} zł</span>
          <UIcon v-if="loading === pack.id" name="i-lucide-loader-circle" class="spin size-4.5" />
        </button>
      </div>
      <p v-if="error" class="payment-error" aria-live="polite">{{ error }}</p>
      <p v-else-if="!configured" class="payment-error">{{ t('payment.notConfigured') }}</p>
      <div class="payment-methods"><span><UIcon name="i-lucide-smartphone" class="size-4.5" />BLIK</span><span><UIcon name="i-lucide-credit-card" class="size-4.5" />{{ t('payment.methods.card') }}</span><small>{{ t('payment.methods.secure') }}</small></div>
    </template>
  </UModal>
</template>
