import { flags } from '../featureFlags.js'
import { getClientId } from './favorites.js'

/** Fire-and-forget product event, sent only when the user has opted into analytics. */
export function track(name, properties) {
  if (!flags.analytics) return
  getClientId().then((clientId) => fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, name, properties }),
    keepalive: true,
  })).catch(() => {})
}
