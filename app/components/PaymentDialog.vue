<script setup>
import { computed, onMounted, ref } from 'vue'
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
const successOpen = ref(false)
const successTier = ref('')
const fetching = ref(false)
const verifying = ref(false)
const tiersLoaded = ref(false)
const eligibleTiers = computed(() => tiers.value.filter((tier) => {
  if (paidTier.value === 'unlimited') return false
  if (paidTier.value === 'pro') return tier.id === 'unlimited'
  return true
}))

/** Open the modal and fetch current server-owned pricing. */
async function open() {
  error.value = ''
  isOpen.value = true
  if (tiersLoaded.value) return
  await loadTiers()
}

async function loadTiers() {
  fetching.value = true
  try {
    const response = await fetch('/api/payments/packs')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || t('payment.errors.loadFailed'))
    tiers.value = data.tiers || []
    configured.value = data.configured
    tiersLoaded.value = true
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : t('payment.errors.loadFailed')
  } finally { fetching.value = false }
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
      body: JSON.stringify({
        tierId: tier.id,
        clientId,
        returnPath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      }),
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
  if (params.get('payment') !== 'success' || !sessionId) {
    if (params.get('payment') === 'cancelled') clearPaymentQuery()
    return
  }
  const claimed = JSON.parse(localStorage.getItem('domainmate.claimedSessions') || '[]')
  if (claimed.includes(sessionId)) return clearPaymentQuery()
  verifying.value = true
  try {
    const response = await fetch(`/api/payments/verify?session_id=${encodeURIComponent(sessionId)}`)
    const data = await response.json()
    if (response.ok && data.paid && data.tierId) {
      localStorage.setItem('domainmate.claimedSessions', JSON.stringify([...claimed, sessionId]))
      unlockTier(data.tierId)
      emit('unlocked')
      track('payment_completed', { tier: data.tierId })
      successTier.value = data.tierId
      successOpen.value = true
    } else paymentNotice.value = t('payment.notice.notCompleted')
  } catch { paymentNotice.value = t('payment.notice.verifyFailed') }
  finally { verifying.value = false }
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
  <div v-if="paymentNotice" class="payment-toast" role="status">
    <UIcon name="i-lucide-info" class="size-4" />
    <span>{{ paymentNotice }}</span>
    <button type="button" :aria-label="t('payment.close')" @click="paymentNotice = ''"><UIcon name="i-lucide-x" class="size-3.5" /></button>
  </div>
  <UModal v-model:open="isOpen" :ui="{ content: 'payment-dialog-body' }">
    <template #header>
      <div class="dialog-header w-full">
        <div><p class="dialog-eyebrow">{{ t('payment.eyebrow') }}</p><h2>{{ t('payment.title') }}</h2></div>
        <UButton :aria-label="t('payment.close')" icon="i-lucide-x" color="neutral" variant="ghost" @click="isOpen = false" />
      </div>
    </template>
    <template #body>
      <p class="balance-line"><span>{{ t('payment.currentTierLabel') }}</span><strong>{{ t(`tierName.${paidTier || 'free'}`) }}</strong></p>
      <p v-if="fetching" class="payment-loading" role="status"><UIcon name="i-lucide-loader-circle" class="spin size-4.5" />{{ t('payment.loading') }}</p>
      <div v-else class="pack-grid">
        <article v-for="tier in eligibleTiers" :key="tier.id" class="pack-option" :class="{ featured: tier.id === 'unlimited' }">
          <div class="pack-heading"><span class="pack-label">{{ t(`tierName.${tier.id}`) }}</span><UIcon v-if="tier.id === 'unlimited'" name="i-lucide-sparkles" class="size-4" /></div>
          <strong>{{ tier.domainLimit ? t('payment.domainsCount', { count: tier.domainLimit }) : t('payment.unlimitedDomains') }}</strong>
          <p class="pack-price"><span>${{ (tier.amount / 100).toFixed(2) }}</span><small>{{ t('payment.oneTime') }}</small></p>
          <ul class="pack-benefits">
            <li><UIcon name="i-lucide-check" class="size-4" />{{ t('payment.benefits.results') }}</li>
            <li><UIcon name="i-lucide-check" class="size-4" />{{ t('payment.benefits.sync') }}</li>
          </ul>
          <UButton color="primary" block :variant="tier.id === 'unlimited' ? 'solid' : 'soft'" :loading="loading === tier.id" :disabled="Boolean(loading) || !configured" @click="checkout(tier)">{{ t('topbar.upgrade') }} {{ t(`tierName.${tier.id}`) }}</UButton>
        </article>
      </div>
      <p v-if="error" class="payment-error" aria-live="polite">{{ error }}</p>
      <UButton v-if="error && !tiersLoaded" class="payment-retry" color="neutral" variant="outline" @click="loadTiers">{{ t('payment.retry') }}</UButton>
      <p v-if="!error && !configured" class="payment-error">{{ t('payment.notConfigured') }}</p>
      <div class="payment-methods"><span><UIcon name="i-lucide-lock-keyhole" class="size-4.5" />{{ t('payment.methods.dynamic') }}</span><small>{{ t('payment.methods.secure') }}</small></div>
    </template>
  </UModal>
  <UModal v-model:open="verifying" :dismissible="false" :ui="{ content: 'payment-success-body' }">
    <template #body><p class="payment-verifying" role="status"><UIcon name="i-lucide-loader-circle" class="spin size-5" />{{ t('payment.verifying') }}</p></template>
  </UModal>
  <UModal v-model:open="successOpen" :ui="{ content: 'payment-success-body' }">
    <template #header>
      <div class="dialog-header w-full">
        <div><p class="dialog-eyebrow">{{ t('payment.success.eyebrow') }}</p><h2>{{ t('payment.success.title') }}</h2></div>
        <UButton :aria-label="t('payment.close')" icon="i-lucide-x" color="neutral" variant="ghost" @click="successOpen = false" />
      </div>
    </template>
    <template #body>
      <div class="success-body">
        <UIcon name="i-lucide-party-popper" class="success-icon" />
        <p class="success-message">{{ t('payment.success.message', { tier: t(`tierName.${successTier}`) }) }}</p>
        <UButton color="primary" block @click="successOpen = false">{{ t('payment.success.continue') }}</UButton>
      </div>
    </template>
  </UModal>
</template>
