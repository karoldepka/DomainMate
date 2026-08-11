import posthog from 'posthog-js'
import { watch } from 'vue'
import { flags } from '../featureFlags.js'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const { projectToken, host } = runtimeConfig.public.posthog

  if (!projectToken || !host) {
    if (import.meta.dev) {
      const missingVariable = !projectToken
        ? 'NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN'
        : 'NUXT_PUBLIC_POSTHOG_HOST'
      throw new Error(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`)
    }
    return
  }

  const posthogClient = posthog.init(projectToken, {
    api_host: host
  })

  // Tags every event (including autocapture) so the PostHog-side "internal and test
  // users" filter can exclude this device's traffic; toggled from the hidden feature-flags
  // panel (five clicks on the logo — see featureFlags.js), so it survives hydration timing.
  watch(() => flags.isInternalUser, (value) => {
    if (value) posthogClient.register({ is_internal_user: true })
    else posthogClient.unregister('is_internal_user')
  }, { immediate: true })

  nuxtApp.hook('vue:error', (error) => {
    posthogClient.captureException(error)
  })

  return {
    provide: {
      posthog: posthogClient
    }
  }
})
