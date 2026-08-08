import { computed, reactive, watch } from 'vue'

const storageKey = 'domainmate.featureFlags'

/** Backend/AI-dependent features are off by default so the frontend works as a static product. */
const defaultFlags = {
  searchResults: false,
  aiSuggestions: false,
  payments: true,
  favoritesSync: false,
  crashReporting: false,
  analytics: false,
  proTier: false,
  unlimitedPro: false,
  advancedQuery: false,
}

export const flagList = [
  { key: 'searchResults', label: 'Google result counts', description: 'Calls the backend search proxy to show how crowded a name already is.' },
  { key: 'aiSuggestions', label: 'AI word suggestions', description: 'Calls the backend and an LLM for creative alternative word parts.' },
  { key: 'payments', label: 'Credits & payments', description: 'Shows the Pro/Unlimited one-time purchase options in the topbar.' },
  { key: 'favoritesSync', label: 'Sync ratings to server', description: 'Syncs star ratings to the backend so they follow you across browsers.' },
  { key: 'crashReporting', label: 'Send crash reports', description: 'Sends unexpected error details to the backend to help fix bugs.' },
  { key: 'analytics', label: 'Product analytics', description: 'Sends anonymous usage events (searches run, favorites, price checks) to help improve the product.' },
  { key: 'proTier', label: 'Pro tier (dev)', description: 'Unlocks the Pro tier (500 domain candidates) on this device, as if a $5 payment succeeded.' },
  { key: 'unlimitedPro', label: 'Unlimited tier (dev)', description: 'Unlocks the Unlimited tier (no domain cap) on this device, as if a $10 payment succeeded.' },
  { key: 'advancedQuery', label: 'Advanced query editor', description: 'Shows the raw editable query text behind the generated form fields.' },
]

// Always starts at the all-off defaults, matching the prerendered/SSR shell exactly,
// so client hydration never mismatches. The real stored overrides (if any) are applied
// after mount via hydrateFlagsFromStorage(), which is a plain reactive update at that
// point rather than a hydration comparison.
export const flags = reactive({ ...defaultFlags })

watch(flags, (value) => {
  if (import.meta.client) localStorage.setItem(storageKey, JSON.stringify(value))
}, { deep: true })

/** Apply stored flag overrides, once mounted. */
export function hydrateFlagsFromStorage() {
  try {
    Object.assign(flags, { ...defaultFlags, ...JSON.parse(localStorage.getItem(storageKey) || '{}') })
  } catch { /* Keep defaults when storage is unavailable or malformed. */ }
}

/** Free feedback unlocks the Basic tier (200 domain candidates), same as before it was called "Pro". */
export const basicUnlocked = computed(() => flags.searchResults && flags.aiSuggestions && flags.favoritesSync)

/** Which paid, one-time-purchase tier (if any) is unlocked on this device. */
export const paidTier = computed(() => {
  if (flags.unlimitedPro) return 'unlimited'
  if (flags.proTier) return 'pro'
  return null
})

/** The single source of truth for how many domain candidates this device may see. */
export const domainLimit = computed(() => {
  if (flags.unlimitedPro) return Infinity
  if (flags.proTier) return 500
  if (basicUnlocked.value) return 200
  return 50
})
