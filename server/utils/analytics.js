import { database, fanoutWrite, usingHostedDatabase } from './database.js'

if (!usingHostedDatabase) database.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    properties TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  ) STRICT;
`)

const allowedEventNames = new Set([
  'search_run',
  'domain_favorited',
  'price_comparison_opened',
  'pro_prompt_shown',
])

export async function recordEvent(clientId, name, properties) {
  if (!allowedEventNames.has(name)) return
  const createdAt = Date.now()
  const safeProperties = properties && typeof properties === 'object' ? properties : {}
  if (!usingHostedDatabase) {
    database.prepare('INSERT INTO events (client_id, name, properties, created_at) VALUES (?, ?, ?, ?)')
      .run(clientId, name, JSON.stringify(safeProperties).slice(0, 2000), createdAt)
    return
  }
  await fanoutWrite((sql) => sql`
    INSERT INTO domainmate.events (client_id, name, properties, created_at)
    VALUES (${clientId}, ${name}, ${sql.json(safeProperties)}, ${createdAt})
  `)
}
