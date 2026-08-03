import { syncFavorites } from '../../utils/favorites.js'
import { normalizeFavorite } from '../../utils/validation.js'

export default defineEventHandler(async (event) => {
  let body
  try {
    body = await readBody(event)
  } catch {
    setResponseStatus(event, 400)
    return { error: 'Invalid JSON in request body.' }
  }

  const clientId = String(body?.clientId || '')
  const records = Array.isArray(body?.records) ? body.records : []
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
    setResponseStatus(event, 400)
    return { error: 'Invalid client ID.' }
  }
  if (records.length > 1000) {
    setResponseStatus(event, 400)
    return { error: 'Too many favorite records.' }
  }
  const normalized = records.map(normalizeFavorite).filter(Boolean)
  if (normalized.length !== records.length) {
    setResponseStatus(event, 400)
    return { error: 'Invalid favorite record.' }
  }
  return { records: syncFavorites(clientId, normalized) }
})
