import { getAnalyticsSummary } from '../../utils/analytics.js'

export default defineEventHandler(async (event) => {
  const adminToken = process.env.ADMIN_TOKEN
  if (!adminToken) {
    setResponseStatus(event, 503)
    return { error: 'ADMIN_TOKEN is not configured on the server.' }
  }
  const provided = getHeader(event, 'x-admin-token') || getQuery(event).token
  if (provided !== adminToken) {
    setResponseStatus(event, 401)
    return { error: 'Invalid or missing admin token.' }
  }
  return await getAnalyticsSummary()
})
