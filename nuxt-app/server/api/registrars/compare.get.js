import { compareRegistrarPrices } from '../../utils/registrars.js'
import { domainPattern } from '../../utils/validation.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const domain = String(query.domain || '').trim().toLowerCase()
  if (!domainPattern.test(domain)) {
    setResponseStatus(event, 400)
    return { error: 'Enter a valid domain name.' }
  }
  setResponseHeader(event, 'Content-Type', 'application/x-ndjson')
  const response = event.node.res
  let closed = false
  event.node.req.on('close', () => { closed = true })
  await compareRegistrarPrices(domain, (quote) => { if (!closed) response.write(`${JSON.stringify({ quote })}\n`) })
  if (!closed) response.end()
})
