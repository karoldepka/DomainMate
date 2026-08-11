import { flags } from '../featureFlags.js'
import { getClientId } from './favorites.js'

/** Fire-and-forget product event, sent only when the user has opted into analytics. */
export function track(name, properties) {
  if (!flags.analytics) return
  const { $posthog } = useNuxtApp()
  $posthog?.capture(name, properties)
  getClientId().then((clientId) => fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, name, properties }),
    keepalive: true,
  })).catch(() => {})
}

/** Fires a Microsoft UET (Bing Ads) custom event; unconditional, matching the base pageLoad tag in nuxt.config.js. */
export function trackUetEvent(action, label) {
  window.uetq = window.uetq || []
  window.uetq.push('event', action, { event_category: 'engagement', event_label: label })
}
