import { database } from './database.js'

database.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
`)

const insert = database.prepare('INSERT INTO feedback (client_id, message, created_at) VALUES (?, ?, ?)')
const hasFeedback = database.prepare('SELECT 1 FROM feedback WHERE client_id = ? LIMIT 1')

/** @param {string} clientId @param {string} message */
export function submitFeedback(clientId, message) {
  insert.run(clientId, message, Date.now())
}

/** @param {string} clientId @returns {boolean} */
export function hasSubmittedFeedback(clientId) {
  return Boolean(hasFeedback.get(clientId))
}
