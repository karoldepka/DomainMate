import { database, fanoutWrite, fastestPeerRead, usingHostedDatabase } from './database.js'

if (!usingHostedDatabase) database.exec(`
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    tier_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (session_id)
  ) STRICT;
`)

/** Idempotent on session_id, so re-verifying the same Stripe session never double-records a purchase. */
export async function recordPurchase(clientId, sessionId, tierId) {
  const createdAt = Date.now()
  if (!usingHostedDatabase) {
    database.prepare('INSERT OR IGNORE INTO purchases (client_id, session_id, tier_id, created_at) VALUES (?, ?, ?, ?)')
      .run(clientId, sessionId, tierId, createdAt)
    return
  }
  await fanoutWrite((sql) => sql`
    INSERT INTO domainmate.purchases (client_id, session_id, tier_id, created_at)
    VALUES (${clientId}, ${sessionId}, ${tierId}, ${createdAt})
    ON CONFLICT (session_id) DO NOTHING
  `)
}

/** The highest tier this client has ever purchased, or null. */
export async function getPurchasedTier(clientId) {
  if (!usingHostedDatabase) {
    const rows = database.prepare('SELECT tier_id FROM purchases WHERE client_id = ?').all(clientId)
    return highestTier(rows.map((row) => row.tier_id))
  }
  const rows = await fastestPeerRead((sql) => sql`SELECT tier_id FROM domainmate.purchases WHERE client_id = ${clientId}`)
  return highestTier(rows.map((row) => row.tier_id))
}

/** @param {string[]} tierIds */
function highestTier(tierIds) {
  if (tierIds.includes('unlimited')) return 'unlimited'
  if (tierIds.includes('pro')) return 'pro'
  return null
}
