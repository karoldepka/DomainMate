<script setup>
import { onMounted, ref } from 'vue'
import { t } from '../i18n/index.js'
import { track } from '../services/analytics.js'
import { flags, paidTier } from '../featureFlags.js'
import { getClientId } from '../services/favorites.js'

const emit = defineEmits(['unlocked'])
const isOpen = ref(false)
const tiers = ref([])
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
    tiers.value = data.tiers || []
    configured.value = data.configured
  } catch { error.value = t('payment.errors.loadFailed') }
}

/** @param {{id: string}} tier */
async function checkout(tier) {
  loading.value = tier.id
  error.value = ''
  try {
    const clientId = await getClientId()
    const response = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tierId: tier.id, clientId }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || t('payment.errors.checkoutFailed'))
    track('checkout_started', { tier: tier.id })
    window.location.assign(data.url)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : t('payment.errors.checkoutFailed')
    loading.value = ''
  }
}

/** Apply the flags for a purchased tier; unlimited also implies everything pro and basic grant. */
function unlockTier(tierId) {
  flags.searchResults = true
  flags.aiSuggestions = true
  flags.favoritesSync = true
  if (tierId === 'pro') flags.proTier = true
  if (tierId === 'unlimited') { flags.proTier = true; flags.unlimitedPro = true }
}

/** Verify Stripe's return value before unlocking a tier on this browser once. */
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
    if (response.ok && data.paid && data.tierId) {
      localStorage.setItem('domainmate.claimedSessions', JSON.stringify([...claimed, sessionId]))
      unlockTier(data.tierId)
      emit('unlocked')
      track('payment_completed', { tier: data.tierId })
      paymentNotice.value = t('payment.notice.unlocked', { tier: t(`tierName.${data.tierId}`) })
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
      <p class="balance-line"><span>{{ t('payment.currentTierLabel') }}</span><strong>{{ t(`tierName.${paidTier || 'free'}`) }}</strong></p>
      <div class="pack-grid">
        <button v-for="tier in tiers" :key="tier.id" type="button" class="pack-option" :disabled="loading || !configured" @click="checkout(tier)">
          <span class="pack-label">{{ t(`tierName.${tier.id}`) }}</span>
          <strong>{{ tier.domainLimit ? t('payment.domainsCount', { count: tier.domainLimit }) : t('payment.unlimitedDomains') }}</strong>
          <span>${{ (tier.amount / 100).toFixed(2) }}</span>
          <UIcon v-if="loading === tier.id" name="i-lucide-loader-circle" class="spin size-4.5" />
        </button>
      </div>
      <p v-if="error" class="payment-error" aria-live="polite">{{ error }}</p>
      <p v-else-if="!configured" class="payment-error">{{ t('payment.notConfigured') }}</p>
      <div class="payment-methods"><span><UIcon name="i-lucide-credit-card" class="size-4.5" />{{ t('payment.methods.card') }}</span><small>{{ t('payment.methods.secure') }}</small></div>
    </template>
  </UModal>
</template>
