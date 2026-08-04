import { database, fanoutWrite, usingHostedDatabase } from './database.js'

if (!usingHostedDatabase) database.exec(`
  CREATE TABLE IF NOT EXISTS client_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    stack TEXT,
    url TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL
  ) STRICT;
`)

export async function recordClientError(report) {
  const values = [
    String(report.message || '').slice(0, 2000),
    String(report.stack || '').slice(0, 4000),
    String(report.url || '').slice(0, 500),
    String(report.userAgent || '').slice(0, 300),
    Date.now()
  ]
  if (!usingHostedDatabase) {
    database.prepare('INSERT INTO client_errors (message, stack, url, user_agent, created_at) VALUES (?, ?, ?, ?, ?)').run(...values)
    return
  }
  await fanoutWrite((sql) => sql`
    INSERT INTO domainmate.client_errors (message, stack, url, user_agent, created_at)
    VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]})
  `)
}
