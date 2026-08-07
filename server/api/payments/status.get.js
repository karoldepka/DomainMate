import { getPurchasedTier } from '../../utils/purchases.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const clientId = String(query.clientId || '')
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
    setResponseStatus(event, 400)
    return { error: 'Invalid client ID.' }
  }
  return { tier: await getPurchasedTier(clientId) }
})
