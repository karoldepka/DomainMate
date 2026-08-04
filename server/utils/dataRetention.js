import { database, fanoutWrite, usingHostedDatabase } from './database.js'

const retentionMs = 365 * 24 * 60 * 60 * 1000
const sweepIntervalMs = 24 * 60 * 60 * 1000

export async function sweepExpiredData() {
  const cutoff = Date.now() - retentionMs
  if (!usingHostedDatabase) {
    database.prepare('DELETE FROM favorites WHERE updated_at < ?').run(cutoff)
    database.prepare('DELETE FROM feedback WHERE created_at < ?').run(cutoff)
    database.prepare('DELETE FROM client_errors WHERE created_at < ?').run(cutoff)
    return
  }
  await fanoutWrite(async (sql) => {
    await sql`DELETE FROM domainmate.favorites WHERE updated_at < ${cutoff}`
    await sql`DELETE FROM domainmate.feedback WHERE created_at < ${cutoff}`
    await sql`DELETE FROM domainmate.client_errors WHERE created_at < ${cutoff}`
  })
}

export function scheduleDataRetentionSweep() {
  void sweepExpiredData().catch((error) => console.error('Data retention sweep failed:', error))
  return setInterval(() => {
    void sweepExpiredData().catch((error) => console.error('Data retention sweep failed:', error))
  }, sweepIntervalMs).unref()
}
