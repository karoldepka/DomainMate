import { recordEvent } from '../../utils/analytics.js'

export default defineEventHandler(async (event) => {
  let body
  try {
    body = await readBody(event)
  } catch {
    setResponseStatus(event, 400)
    return { error: 'Invalid JSON in request body.' }
  }

  const clientId = String(body?.clientId || '').trim()
  const name = String(body?.name || '').trim()
  if (!clientId || !name) {
    setResponseStatus(event, 400)
    return { error: 'clientId and name are required.' }
  }
  await recordEvent(clientId, name, body?.properties)
  return { ok: true }
})
