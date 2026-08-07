import Stripe from 'stripe'
import { PaymentError } from './paymentError.js'
import { recordPurchase } from './purchases.js'

/** @typedef {{id: string, domainLimit: number|null, amount: number, label: string}} ProTier */

/** One-time purchases that raise the domain-candidate cap. Amounts are in US cents. domainLimit: null means uncapped. */
export const proTiers = [
  { id: 'pro', domainLimit: 500, amount: 500, label: 'Pro' },
  { id: 'unlimited', domainLimit: null, amount: 1000, label: 'Unlimited' },
]

/** @returns {Stripe|null} */
export function getStripe() {
  return process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null
}

/** @param {string} tierId @param {string} origin @param {string} clientId */
export async function createCheckout(tierId, origin, clientId) {
  const stripe = getStripe()
  if (!stripe) throw new PaymentError('Payments are not configured.', 503)
  const tier = proTiers.find((item) => item.id === tierId)
  if (!tier) throw new PaymentError('Unknown pro tier.', 400)
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new PaymentError('Invalid client ID.', 400)

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: tier.amount,
        product_data: { name: `DomainMate ${tier.label}`, description: `One-time unlock: ${tier.domainLimit ? `${tier.domainLimit} domain candidates` : 'unlimited domain candidates'}` },
      },
    }],
    metadata: { tierId: tier.id, clientId },
    payment_intent_data: { description: `DomainMate ${tier.label} unlock` },
    success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?payment=cancelled`,
  })
  return { url: session.url }
}

/** @param {string} sessionId */
export async function verifyCheckout(sessionId) {
  const stripe = getStripe()
  if (!stripe) throw new PaymentError('Payments are not configured.', 503)
  if (!/^cs_(test|live)_[A-Za-z0-9_]+$/.test(sessionId)) throw new PaymentError('Invalid checkout session.', 400)
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  return recordSessionIfPaid(session)
}

/**
 * Shared by the success-page verify call and the webhook, since either one may see the
 * paid session first (the browser can fail to return after a slow or async payment method).
 * recordPurchase is idempotent on session_id, so recording it twice is harmless.
 * @param {import('stripe').Stripe.Checkout.Session} session
 */
export async function recordSessionIfPaid(session) {
  const tierId = session.metadata?.tierId || null
  const clientId = session.metadata?.clientId || null
  const paid = session.payment_status === 'paid'
  if (paid && tierId && clientId) await recordPurchase(clientId, session.id, tierId)
  return { paid, tierId }
}
