import { proTiers } from '../../utils/payments.js'

export default defineEventHandler(() => {
  return { configured: Boolean(process.env.STRIPE_SECRET_KEY), currency: 'USD', tiers: proTiers }
})
