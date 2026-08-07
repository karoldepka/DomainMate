import { createCheckout } from '../../utils/payments.js'
import { PaymentError } from '../../utils/paymentError.js'

export default defineEventHandler(async (event) => {
  let body
  try {
    body = await readBody(event)
  } catch {
    setResponseStatus(event, 400)
    return { error: 'Invalid JSON in request body.' }
  }

  try {
    const origin = getAllowedOrigin(event)
    return await createCheckout(String(body?.tierId || ''), origin, String(body?.clientId || ''))
  } catch (error) {
    const status = error instanceof PaymentError ? error.status : 500
    setResponseStatus(event, status)
    return { error: error instanceof Error ? error.message : 'Checkout failed.' }
  }
})

/** Only return known local or explicitly configured origins for Stripe redirects. */
function getAllowedOrigin(event) {
  const configured = process.env.APP_URL?.replace(/\/$/, '')
  if (configured) return configured
  const origin = String(getHeader(event, 'origin') || '')
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
  throw new PaymentError('Set APP_URL before accepting production payments.', 400)
}
