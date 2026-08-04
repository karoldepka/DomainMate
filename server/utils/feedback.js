import { database, fanoutWrite, peerReads, usingHostedDatabase } from './database.js'

if (!usingHostedDatabase) database.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
`)

export async function submitFeedback(clientId, message) {
  const createdAt = Date.now()
  if (!usingHostedDatabase) {
    database.prepare('INSERT INTO feedback (client_id, message, created_at) VALUES (?, ?, ?)').run(clientId, message, createdAt)
    return
  }
  await fanoutWrite((sql) => sql`INSERT INTO domainmate.feedback (client_id, message, created_at) VALUES (${clientId}, ${message}, ${createdAt})`)
}

export async function hasSubmittedFeedback(clientId) {
  if (!usingHostedDatabase) return Boolean(database.prepare('SELECT 1 FROM feedback WHERE client_id = ? LIMIT 1').get(clientId))
  const peerRows = await peerReads((sql) => sql`SELECT 1 FROM domainmate.feedback WHERE client_id = ${clientId} LIMIT 1`)
  return peerRows.some((rows) => rows.length > 0)
}
