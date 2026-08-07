import { getStripe, recordSessionIfPaid } from '../../utils/payments.js'

/**
 * Records purchases from Stripe's server-to-server event, independent of the browser
 * making it back to the success page (closed tab, dropped connection, async payment
 * methods like BLIK that confirm after the redirect). /api/payments/verify.get.js also
 * records the same session; recordSessionIfPaid is idempotent so both can fire safely.
 */
export default defineEventHandler(async (event) => {
  const stripe = getStripe()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripe || !webhookSecret) {
    setResponseStatus(event, 503)
    return { error: 'Webhook is not configured.' }
  }

  const signature = getHeader(event, 'stripe-signature')
  const rawBody = await readRawBody(event)
  if (!signature || !rawBody) {
    setResponseStatus(event, 400)
    return { error: 'Missing Stripe signature or body.' }
  }

  let stripeEvent
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch {
    setResponseStatus(event, 400)
    return { error: 'Invalid webhook signature.' }
  }

  if (stripeEvent.type === 'checkout.session.completed' || stripeEvent.type === 'checkout.session.async_payment_succeeded') {
    await recordSessionIfPaid(stripeEvent.data.object)
  }

  return { received: true }
})
