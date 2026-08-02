import Stripe from 'stripe'

/** @typedef {{id: string, credits: number, amount: number, label: string}} CreditPack */

/** @type {CreditPack[]} Amounts are expressed in Polish grosz. */
export const creditPacks = [
  { id: 'starter', credits: 20, amount: 500, label: 'Starter' },
  { id: 'builder', credits: 75, amount: 1200, label: 'Builder' },
  { id: 'studio', credits: 250, amount: 2900, label: 'Studio' },
]

/** @returns {Stripe|null} */
function getStripe() {
  return process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null
}

/** @param {string} packId @param {string} origin */
export async function createCheckout(packId, origin) {
  const stripe = getStripe()
  if (!stripe) throw new PaymentError('Payments are not configured.', 503)
  const pack = creditPacks.find((item) => item.id === packId)
  if (!pack) throw new PaymentError('Unknown credit pack.', 400)

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'blik'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'pln',
        unit_amount: pack.amount,
        product_data: { name: `${pack.credits} DomainMate credits`, description: `${pack.label} research credit pack` },
      },
    }],
    metadata: { packId: pack.id, credits: String(pack.credits) },
    payment_intent_data: { description: `DomainMate ${pack.credits} credits` },
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
  const credits = Number(session.metadata?.credits || 0)
  return { paid: session.payment_status === 'paid', credits, packId: session.metadata?.packId || null }
}

export class PaymentError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) { super(message); this.status = status }
}

