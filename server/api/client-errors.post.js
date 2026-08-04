import { recordClientError } from '../utils/clientErrors.js'

export default defineEventHandler(async (event) => {
  let body
  try {
    body = await readBody(event)
  } catch {
    setResponseStatus(event, 400)
    return { error: 'Invalid JSON in request body.' }
  }

  const message = String(body?.message || '').trim()
  if (!message) {
    setResponseStatus(event, 400)
    return { error: 'A message is required.' }
  }
  await recordClientError({
    message,
    stack: body?.stack,
    url: body?.url,
    userAgent: body?.userAgent,
  })
  return { ok: true }
})
