import { verifyCheckout } from '../../utils/payments.js'
import { PaymentError } from '../../utils/paymentError.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  try {
    return await verifyCheckout(String(query.session_id || ''))
  } catch (error) {
    const status = error instanceof PaymentError ? error.status : 500
    setResponseStatus(event, status)
    return { error: error instanceof Error ? error.message : 'Verification failed.' }
  }
})
