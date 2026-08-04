import { computed, reactive, watch } from 'vue'

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

/** @returns {typeof defaultFlags} */
function loadFlags() {
  try {
    return { ...defaultFlags, ...JSON.parse(localStorage.getItem(storageKey) || '{}') }
  } catch {
    return { ...defaultFlags }
  }
}

export const flags = reactive(loadFlags())

watch(flags, (value) => localStorage.setItem(storageKey, JSON.stringify(value)), { deep: true })

/** The single source of truth for what counts as "pro" across the app. */
export const proUnlocked = computed(() => flags.searchResults && flags.aiSuggestions && flags.favoritesSync)
