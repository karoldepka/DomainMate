import { timingSafeEqual } from 'node:crypto'
import { getAnalyticsSummary } from '../../utils/analytics.js'

/** Reject early on type/length mismatches (not secret) before the constant-time byte comparison. */
function matchesToken(provided, expected) {
  if (typeof provided !== 'string') return false
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer)
}

export default defineEventHandler(async (event) => {
  const adminToken = process.env.ADMIN_TOKEN
  if (!adminToken) {
    setResponseStatus(event, 503)
    return { error: 'ADMIN_TOKEN is not configured on the server.' }
  }
  const provided = getHeader(event, 'x-admin-token') || getQuery(event).token
  if (!matchesToken(provided, adminToken)) {
    setResponseStatus(event, 401)
    return { error: 'Invalid or missing admin token.' }
  }
  return await getAnalyticsSummary()
})
