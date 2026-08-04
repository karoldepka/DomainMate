import { database } from './database.js'

const retentionMs = 365 * 24 * 60 * 60 * 1000
const sweepIntervalMs = 24 * 60 * 60 * 1000

const deleteOldFavorites = database.prepare('DELETE FROM favorites WHERE updated_at < ?')
const deleteOldFeedback = database.prepare('DELETE FROM feedback WHERE created_at < ?')
const deleteOldClientErrors = database.prepare('DELETE FROM client_errors WHERE created_at < ?')

/** Enforce the privacy policy's ~12-month retention window for stored user data. */
export function sweepExpiredData() {
  const cutoff = Date.now() - retentionMs
  deleteOldFavorites.run(cutoff)
  deleteOldFeedback.run(cutoff)
  deleteOldClientErrors.run(cutoff)
}

/** Run the retention sweep once at startup, then once a day. */
export function scheduleDataRetentionSweep() {
  sweepExpiredData()
  return setInterval(sweepExpiredData, sweepIntervalMs).unref()
}
