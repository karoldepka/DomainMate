import { submitFeedback } from '../../utils/feedback.js'

export default defineEventHandler(async (event) => {
  let body
  try {
    body = await readBody(event)
  } catch {
    setResponseStatus(event, 400)
    return { error: 'Invalid JSON in request body.' }
  }

  const clientId = String(body?.clientId || '')
  const message = String(body?.message || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
    setResponseStatus(event, 400)
    return { error: 'Invalid client ID.' }
  }
  if (!message || message.length > 4000) {
    setResponseStatus(event, 400)
    return { error: 'Feedback must be between 1 and 4000 characters.' }
  }
  submitFeedback(clientId, message)
  return { ok: true }
})
