import { creditPacks } from '../../utils/payments.js'

export default defineEventHandler(() => {
  return { configured: Boolean(process.env.STRIPE_SECRET_KEY), currency: 'PLN', packs: creditPacks }
})
