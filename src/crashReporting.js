import { flags } from './featureFlags.js'

/** Report to the backend only when the user has opted in via the crashReporting flag. */
function report(message, stack) {
  if (!flags.crashReporting) return
  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: String(message ?? 'Unknown error'),
      stack: stack ? String(stack) : undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
    }),
    keepalive: true,
  }).catch(() => {})
}

/** @param {import('vue').App} app */
export function installCrashReporting(app) {
  app.config.errorHandler = (error, _instance, info) => {
    report(error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : undefined)
    console.error(error, info)
  }
  window.addEventListener('error', (event) => report(event.message, event.error?.stack))
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    report(reason instanceof Error ? reason.message : String(reason), reason instanceof Error ? reason.stack : undefined)
  })
}
