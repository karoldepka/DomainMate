import { track as trackVercelAnalytics } from '@vercel/analytics/server'
import { database, fanoutWrite, fastestPeerRead, usingHostedDatabase } from './database.js'

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
  'feedback_submitted',
  'checkout_started',
  'payment_completed',
])

// PostHog capture happens client-side (see app/plugins/posthog.client.js) so it isn't
// duplicated here; Vercel Analytics has no client-side custom-event wiring, so it's
// forwarded from this single server call site instead.
/** Fire-and-forget; trackVercelAnalytics() catches and logs its own failures internally. */
function forwardToExternalAnalytics(name, properties, requestHeaders) {
  // Vercel's server-side track() needs request headers to attribute the event; skip it
  // (rather than let it log its own "no session context" warning) when running without one.
  if (requestHeaders) trackVercelAnalytics(name, properties, { headers: requestHeaders })
}

export async function recordEvent(clientId, name, properties, requestHeaders) {
  if (!allowedEventNames.has(name)) return
  const createdAt = Date.now()
  const safeProperties = properties && typeof properties === 'object' ? properties : {}
  if (!usingHostedDatabase) {
    database.prepare('INSERT INTO events (client_id, name, properties, created_at) VALUES (?, ?, ?, ?)')
      .run(clientId, name, JSON.stringify(safeProperties).slice(0, 2000), createdAt)
  } else {
    await fanoutWrite((sql) => sql`
      INSERT INTO domainmate.events (client_id, name, properties, created_at)
      VALUES (${clientId}, ${name}, ${sql.json(safeProperties)}, ${createdAt})
    `)
  }
  forwardToExternalAnalytics(name, safeProperties, requestHeaders)
}

/** Aggregate counts and the most recent raw events, for the internal analytics dashboard. */
export async function getAnalyticsSummary() {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000
  if (!usingHostedDatabase) {
    const totals = database.prepare('SELECT name, COUNT(*) AS count FROM events GROUP BY name ORDER BY count DESC').all()
    const daily = database.prepare(`
      SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS date, COUNT(*) AS count
      FROM events WHERE created_at >= ? GROUP BY date ORDER BY date
    `).all(since)
    const uniqueClients = database.prepare('SELECT COUNT(DISTINCT client_id) AS count FROM events').get().count
    const recent = database.prepare('SELECT client_id, name, properties, created_at FROM events ORDER BY created_at DESC LIMIT 50').all()
      .map((row) => ({ ...row, properties: JSON.parse(row.properties) }))
    return { totals, daily, uniqueClients, recent }
  }
  const [totals, daily, uniqueClients, recent] = await Promise.all([
    fastestPeerRead((sql) => sql`SELECT name, COUNT(*)::int AS count FROM domainmate.events GROUP BY name ORDER BY count DESC`),
    fastestPeerRead((sql) => sql`
      SELECT to_char(to_timestamp(created_at / 1000), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM domainmate.events WHERE created_at >= ${since} GROUP BY date ORDER BY date
    `),
    fastestPeerRead((sql) => sql`SELECT COUNT(DISTINCT client_id)::int AS count FROM domainmate.events`),
    fastestPeerRead((sql) => sql`SELECT client_id, name, properties, created_at FROM domainmate.events ORDER BY created_at DESC LIMIT 50`),
  ])
  return { totals, daily, uniqueClients: uniqueClients[0]?.count ?? 0, recent }
}
