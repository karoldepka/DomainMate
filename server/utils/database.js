import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import postgres from 'postgres'

const connectionUrls = [
  ['supabase', process.env.SUPABASE_DATABASE_URL],
  ['neon', process.env.NEON_DATABASE_URL]
].filter(([, url]) => Boolean(url))

export const usingHostedDatabase = connectionUrls.length > 0

let database = null
if (!usingHostedDatabase) {
  let dataDirectory = join(process.cwd(), 'data')
  try {
    mkdirSync(dataDirectory, { recursive: true })
  } catch {
    // The project directory is read-only on serverless platforms (e.g. Vercel's
    // /var/task); fall back to the writable temp directory instead.
    dataDirectory = join(tmpdir(), 'domainmate-data')
    mkdirSync(dataDirectory, { recursive: true })
  }
  database = new DatabaseSync(join(dataDirectory, 'domainmate.sqlite'))
}

export { database }

const clients = connectionUrls.map(([name, url]) => {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: 'require'
  })
  return { name, sql, ready: initializeSchema(sql) }
})

async function initializeSchema(sql) {
  await sql`CREATE SCHEMA IF NOT EXISTS domainmate`
  await sql`
    CREATE TABLE IF NOT EXISTS domainmate.favorites (
      client_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 0 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (client_id, domain)
    )
  `
  await sql`ALTER TABLE domainmate.favorites ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT ''`
  await sql`CREATE INDEX IF NOT EXISTS favorites_updated_at_idx ON domainmate.favorites (updated_at)`
  await sql`
    CREATE TABLE IF NOT EXISTS domainmate.feedback (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      client_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS feedback_client_id_idx ON domainmate.feedback (client_id)`
  await sql`CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON domainmate.feedback (created_at)`
  await sql`
    CREATE TABLE IF NOT EXISTS domainmate.client_errors (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      message TEXT NOT NULL,
      stack TEXT,
      url TEXT,
      user_agent TEXT,
      created_at BIGINT NOT NULL
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS client_errors_created_at_idx ON domainmate.client_errors (created_at)`
  await sql`
    CREATE TABLE IF NOT EXISTS domainmate.events (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      client_id TEXT NOT NULL,
      name TEXT NOT NULL,
      properties JSONB NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS events_name_idx ON domainmate.events (name)`
  await sql`CREATE INDEX IF NOT EXISTS events_created_at_idx ON domainmate.events (created_at)`
}

/** Run a write against every configured provider, requiring at least one success. */
export async function fanoutWrite(operation) {
  const results = await Promise.allSettled(clients.map(async ({ sql, ready }) => {
    await ready
    return operation(sql)
  }))
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [{ provider: clients[index].name, reason: result.reason }]
    : [])
  for (const failure of failures) console.error(`Database write failed on ${failure.provider}:`, failure.reason)
  if (failures.length === clients.length) throw new AggregateError(failures.map(({ reason }) => reason), 'Every database write failed')
}

/** Race every peer and return the first successful read without waiting for slower peers. */
export async function fastestPeerRead(operation) {
  return firstSuccessful(clients.map(async ({ name, sql, ready }) => {
    try {
      await ready
      return await operation(sql)
    } catch (error) {
      console.error(`Database read failed on ${name}:`, error)
      throw error
    }
  }))
}

export function firstSuccessful(promises) {
  return Promise.any(promises)
}
