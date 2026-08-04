import { reactive, watch } from 'vue'

const storageKey = 'domainmate.featureFlags'

/** Backend/AI-dependent features are off by default so the frontend works as a static product. */
const defaultFlags = {
  searchResults: false,
  aiSuggestions: false,
  payments: false,
  favoritesSync: false,
  crashReporting: false,
}

export const flagList = [
  { key: 'searchResults', label: 'Google result counts', description: 'Calls the backend search proxy to show how crowded a name already is.' },
  { key: 'aiSuggestions', label: 'AI word suggestions', description: 'Calls the backend and an LLM for creative alternative word parts.' },
  { key: 'payments', label: 'Credits & payments', description: 'Enables the Stripe checkout flow for buying research credits.' },
  { key: 'favoritesSync', label: 'Sync ratings to server', description: 'Syncs star ratings to the backend so they follow you across browsers.' },
  { key: 'crashReporting', label: 'Send crash reports', description: 'Sends unexpected error details to the backend to help fix bugs.' },
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
