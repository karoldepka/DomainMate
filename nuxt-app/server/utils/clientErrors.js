import { database } from './database.js'

database.exec(`
  CREATE TABLE IF NOT EXISTS client_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    stack TEXT,
    url TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL
  ) STRICT;
`)

const insert = database.prepare('INSERT INTO client_errors (message, stack, url, user_agent, created_at) VALUES (?, ?, ?, ?, ?)')

/** @param {{message: string, stack?: string, url?: string, userAgent?: string}} report */
export function recordClientError(report) {
  insert.run(
    String(report.message || '').slice(0, 2000),
    String(report.stack || '').slice(0, 4000),
    String(report.url || '').slice(0, 500),
    String(report.userAgent || '').slice(0, 300),
    Date.now(),
  )
}
