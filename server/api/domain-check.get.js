import { checkDomain } from '../utils/domainLookup.js'
import { domainPattern } from '../utils/validation.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const domain = String(query.domain || '').trim().toLowerCase()
  if (!domainPattern.test(domain)) {
    setResponseStatus(event, 400)
    return { error: 'Enter a valid domain name.' }
  }
  return checkDomain(domain)
})
