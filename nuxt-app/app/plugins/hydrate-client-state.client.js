import { hydrateLocaleFromStorage } from '../i18n/index.js'
import { hydrateFlagsFromStorage } from '../featureFlags.js'

// Runs once the app has mounted (i.e. after hydration completes), so applying the
// user's real stored locale/feature-flag preferences here is a plain reactive update
// rather than something the hydration comparison has to reconcile against the
// prerendered/SSR shell.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => {
    hydrateLocaleFromStorage()
    hydrateFlagsFromStorage()
  })
})
