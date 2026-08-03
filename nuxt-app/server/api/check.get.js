import { checkDomain } from '../utils/domainLookup.js'
import { checkSearch } from '../utils/searchProviders.js'
import { domainPattern } from '../utils/validation.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const domain = String(query.domain || '').trim().toLowerCase()
  const keywords = String(query.keywords || '').trim().slice(0, 200)

  if (!domainPattern.test(domain)) {
    setResponseStatus(event, 400)
    return { error: 'Enter a valid domain name.' }
  }

  const [availability, search] = await Promise.all([
    checkDomain(domain),
    checkSearch(domain, keywords),
  ])

  return { domain, ...availability, search }
})
