import { database, fanoutWrite, fastestPeerRead, usingHostedDatabase } from './database.js'

if (!usingHostedDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      client_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      rating INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (client_id, domain)
    ) STRICT;
  `)
  migrateStarredColumn()
}

/** @typedef {{domain: string, rating: number, updatedAt: number}} FavoriteRecord */

/** Merge browser records into the server and return the authoritative set. */
export async function syncFavorites(clientId, records) {
  if (!usingHostedDatabase) return syncLocalFavorites(clientId, records)

  await fanoutWrite((sql) => sql.begin(async (transaction) => {
    for (const record of records) {
      await transaction`
        INSERT INTO domainmate.favorites (client_id, domain, rating, updated_at)
        VALUES (${clientId}, ${record.domain}, ${record.rating}, ${record.updatedAt})
        ON CONFLICT (client_id, domain) DO UPDATE SET
          rating = EXCLUDED.rating,
          updated_at = EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at >= domainmate.favorites.updated_at
      `
    }
  }))
  const rows = await fastestPeerRead((sql) => sql`
    SELECT domain, rating, updated_at FROM domainmate.favorites
    WHERE client_id = ${clientId}
    ORDER BY updated_at DESC
  `)
  return rows.map(toFavoriteRecord)
}

function syncLocalFavorites(clientId, records) {
  const upsert = database.prepare(`
    INSERT INTO favorites (client_id, domain, rating, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (client_id, domain) DO UPDATE SET
      rating = excluded.rating,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at >= favorites.updated_at
  `)
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const record of records) upsert.run(clientId, record.domain, record.rating, record.updatedAt)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return database.prepare('SELECT domain, rating, updated_at FROM favorites WHERE client_id = ? ORDER BY updated_at DESC')
    .all(clientId).map(toFavoriteRecord)
}

function toFavoriteRecord(record) {
  return { domain: String(record.domain), rating: Number(record.rating), updatedAt: Number(record.updated_at) }
}

function migrateStarredColumn() {
  const columns = database.prepare('PRAGMA table_info(favorites)').all().map((column) => column.name)
  if (!columns.includes('starred')) return
  if (!columns.includes('rating')) database.exec('ALTER TABLE favorites ADD COLUMN rating INTEGER NOT NULL DEFAULT 0')
  database.exec('UPDATE favorites SET rating = 5 WHERE starred = 1 AND rating = 0')
  try { database.exec('ALTER TABLE favorites DROP COLUMN starred') } catch { /* Older SQLite builds keep it. */ }
}
