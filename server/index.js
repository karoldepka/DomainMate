import 'dotenv/config'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { getSearchProvider, getSearchProviderStatus } from './searchProviders.js'
import { createCheckout, creditPacks, PaymentError, verifyCheckout } from './payments.js'
import { syncFavorites } from './favorites.js'
import { compareRegistrarPrices } from './registrars.js'
import { isAiConfigured, suggestSimilarWords } from './ai.js'
import { hasSubmittedFeedback, submitFeedback } from './feedback.js'
import { recordClientError } from './clientErrors.js'

const app = express()
app.disable('x-powered-by')
const port = Number(process.env.PORT) || 8787
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const wordPattern = /^[a-z]{2,20}$/

app.use(express.json())
app.use(securityHeaders)
app.use('/api', rateLimit)

app.post('/api/favorites/sync', (req, res) => {
  const clientId = String(req.body?.clientId || '')
  const records = Array.isArray(req.body?.records) ? req.body.records : []
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: 'Invalid client ID.' })
  if (records.length > 1000) return res.status(400).json({ error: 'Too many favorite records.' })
  const normalized = records.map(normalizeFavorite).filter(Boolean)
  if (normalized.length !== records.length) return res.status(400).json({ error: 'Invalid favorite record.' })
  res.json({ records: syncFavorites(clientId, normalized) })
})

app.post('/api/feedback', (req, res) => {
  const clientId = String(req.body?.clientId || '')
  const message = String(req.body?.message || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: 'Invalid client ID.' })
  if (!message || message.length > 4000) return res.status(400).json({ error: 'Feedback must be between 1 and 4000 characters.' })
  submitFeedback(clientId, message)
  res.json({ ok: true })
})

app.get('/api/feedback/status', (req, res) => {
  const clientId = String(req.query.clientId || '')
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: 'Invalid client ID.' })
  res.json({ unlocked: hasSubmittedFeedback(clientId) })
})

app.post('/api/client-errors', (req, res) => {
  const message = String(req.body?.message || '').trim()
  if (!message) return res.status(400).json({ error: 'A message is required.' })
  recordClientError({
    message,
    stack: req.body?.stack,
    url: req.body?.url,
    userAgent: req.body?.userAgent,
  })
  res.json({ ok: true })
})

app.get('/api/registrars/compare', registrarRateLimit, async (req, res) => {
  const domain = String(req.query.domain || '').trim().toLowerCase()
  if (!domainPattern.test(domain)) return res.status(400).json({ error: 'Enter a valid domain name.' })
  res.setHeader('Content-Type', 'application/x-ndjson')
  let closed = false
  req.on('close', () => { closed = true })
  await compareRegistrarPrices(domain, (quote) => { if (!closed) res.write(`${JSON.stringify({ quote })}\n`) })
  if (!closed) res.end()
})

app.get('/api/payments/packs', (_req, res) => {
  res.json({ configured: Boolean(process.env.STRIPE_SECRET_KEY), currency: 'PLN', packs: creditPacks })
})

app.post('/api/payments/checkout', async (req, res) => {
  try {
    const origin = getAllowedOrigin(req)
    res.json(await createCheckout(String(req.body?.packId || ''), origin))
  } catch (error) {
    const status = error instanceof PaymentError ? error.status : 500
    res.status(status).json({ error: error instanceof Error ? error.message : 'Checkout failed.' })
  }
})

app.get('/api/payments/verify', async (req, res) => {
  try {
    res.json(await verifyCheckout(String(req.query.session_id || '')))
  } catch (error) {
    const status = error instanceof PaymentError ? error.status : 500
    res.status(status).json({ error: error instanceof Error ? error.message : 'Verification failed.' })
  }
})

app.get('/api/check', async (req, res) => {
  const domain = String(req.query.domain || '').trim().toLowerCase()
  const keywords = String(req.query.keywords || '').trim().slice(0, 200)

  if (!domainPattern.test(domain)) {
    return res.status(400).json({ error: 'Enter a valid domain name.' })
  }

  const [availability, search] = await Promise.all([
    checkDomain(domain),
    checkSearch(domain, keywords),
  ])

  res.json({ domain, ...availability, search })
})

app.get('/api/search', async (req, res) => {
  const domain = String(req.query.domain || '').trim().toLowerCase()
  const keywords = String(req.query.keywords || '').trim().slice(0, 200)
  if (!domainPattern.test(domain)) return res.status(400).json({ error: 'Enter a valid domain name.' })
  res.json(await checkSearch(domain, keywords))
})

app.get('/api/domain-check', async (req, res) => {
  const domain = String(req.query.domain || '').trim().toLowerCase()
  if (!domainPattern.test(domain)) return res.status(400).json({ error: 'Enter a valid domain name.' })
  res.json(await checkDomain(domain))
})

app.get('/api/suggest', async (req, res) => {
  const word = String(req.query.word || '').trim().toLowerCase()
  const maxSyllables = Math.min(8, Math.max(1, Number(req.query.maxSyllables) || 3))
  if (!wordPattern.test(word)) return res.status(400).json({ error: 'Enter a valid word.' })
  res.json({ words: await suggestSimilarWords(word, maxSyllables) })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, search: getSearchProviderStatus(), ai: isAiConfigured() })
})

/**
 * Resolve registration status through the TLD's authoritative RDAP service.
 * @param {string} domain
 * @returns {Promise<{availability: string, availabilityNote?: string}>}
 */
async function checkDomain(domain) {
  if (await hasDnsDelegation(domain)) {
    return { availability: 'registered', availabilityNote: 'The domain has delegated DNS nameservers.' }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        headers: { Accept: 'application/rdap+json, application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (response.status === 404) {
        if (isRdapJson(response)) {
          return { availability: 'available', availabilityNote: 'No DNS delegation was found, and RDAP returned not found.' }
        }
        return { availability: 'unknown', availabilityNote: 'No DNS delegation was found, but RDAP does not support this TLD.' }
      }
      if (response.ok) return { availability: 'registered' }
      if (response.status !== 429 && response.status < 500) return { availability: 'unknown', availabilityNote: `Registry returned ${response.status}.` }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, getRetryDelay(response.headers, 350)))
        continue
      }
    } catch { /* Retry transient network and timeout failures once. */ }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return { availability: 'unknown', availabilityNote: 'Registry lookup timed out or was rate limited.' }
}

/** @param {Response} response */
function isRdapJson(response) {
  return response.headers.get('content-type')?.toLowerCase().includes('json') === true
}

/**
 * Query DNS-over-HTTPS when the browser-side lookup is unavailable.
 * @param {string} domain
 * @returns {Promise<boolean>}
 */
async function hasDnsDelegation(domain) {
  try {
    const query = new URLSearchParams({ name: domain, type: 'NS' })
    const response = await fetch(`https://dns.google/resolve?${query}`, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return false
    const result = await response.json()
    return result.Status === 0
      && Array.isArray(result.Answer)
      && result.Answer.some((answer) => answer?.type === 2)
  } catch { return false }
}

/** Honor registrar throttling headers, capped to keep interactive checks responsive. */
function getRetryDelay(headers, fallback) {
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()
    if (Number.isFinite(milliseconds)) return Math.min(5000, Math.max(100, milliseconds))
  }
  const reset = Number(headers.get('ratelimit-reset') || headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) {
    const milliseconds = reset > 1e9 ? reset * 1000 - Date.now() : reset * 1000
    return Math.min(5000, Math.max(100, milliseconds))
  }
  return fallback
}

/**
 * Search for a domain through the configured normalized provider.
 * @param {string} domain
 * @param {string} keywords
 * @returns {Promise<{status: string, query: string, totalResults?: number}>}
 */
async function checkSearch(domain, keywords) {
  const query = keywords ? `\"${domain}\" ${keywords}` : `\"${domain}\"`
  try {
    return await getSearchProvider().search(query)
  } catch (error) {
    return { provider: getSearchProvider().name, status: 'error', query, message: error instanceof Error ? error.message : 'Search failed.' }
  }
}

// Serve the built frontend (vite build output) when it's present, so a single
// process can host both the API and the SPA in production. In local dev the
// frontend is served separately by the Vite dev server, and dist/ won't exist
// yet, so this is a no-op until the first build.
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(join(distDir, 'index.html'))
  })
}

// Registered after every route: catches malformed JSON bodies and any other
// unhandled error so the API always responds with JSON, never an HTML page
// with a stack trace leaking internal file paths.
app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON in request body.' })
  }
  console.error(error)
  res.status(500).json({ error: 'Internal server error.' })
})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => {
    console.log(`DomainMate API listening on http://localhost:${port}`)
  })
}

export { app }

/** Only return known local or explicitly configured origins for Stripe redirects. */
function getAllowedOrigin(req) {
  const configured = process.env.APP_URL?.replace(/\/$/, '')
  if (configured) return configured
  const origin = String(req.headers.origin || '')
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
  throw new PaymentError('Set APP_URL before accepting production payments.', 400)
}

/** Baseline hardening headers; the SPA and JSON API need no inline scripts or framing. */
function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
}

const rateLimitWindowMs = 60_000
const rateLimitMax = 300
const registrarRateLimitMax = 50
const rateLimitBuckets = new Map()
const registrarRateLimitBuckets = new Map()

/** Cap requests per client IP to protect upstream RDAP/DNS/search/AI quotas from abuse. */
function rateLimit(req, res, next) {
  const result = consumeRateLimit(rateLimitBuckets, req.ip, rateLimitMax)
  if (!result.allowed) return res.status(429).set('Retry-After', String(result.retryAfter)).json({ error: 'Too many requests. Please slow down.' })
  next()
}

/** Keep registrar comparisons below the strictest configured provider quota. */
function registrarRateLimit(req, res, next) {
  const result = consumeRateLimit(registrarRateLimitBuckets, req.ip, registrarRateLimitMax)
  res.setHeader('X-RateLimit-Limit', String(registrarRateLimitMax))
  res.setHeader('X-RateLimit-Remaining', String(result.remaining))
  res.setHeader('X-RateLimit-Reset', String(result.retryAfter))
  if (!result.allowed) return res.status(429).set('Retry-After', String(result.retryAfter)).json({ error: 'Too many price comparisons. Please retry shortly.' })
  next()
}

/** @param {Map<string, {windowStart: number, count: number}>} buckets */
function consumeRateLimit(buckets, key, maximum) {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || now - bucket.windowStart >= rateLimitWindowMs) {
    bucket = { windowStart: now, count: 0 }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  const retryAfter = Math.max(1, Math.ceil((bucket.windowStart + rateLimitWindowMs - now) / 1000))
  return { allowed: bucket.count <= maximum, remaining: Math.max(0, maximum - bucket.count), retryAfter }
}

setInterval(() => {
  const cutoff = Date.now() - rateLimitWindowMs
  for (const [key, bucket] of rateLimitBuckets) if (bucket.windowStart < cutoff) rateLimitBuckets.delete(key)
  for (const [key, bucket] of registrarRateLimitBuckets) if (bucket.windowStart < cutoff) registrarRateLimitBuckets.delete(key)
}, rateLimitWindowMs).unref()

/** Validate untrusted browser synchronization records. */
function normalizeFavorite(record) {
  const domain = String(record?.domain || '').toLowerCase()
  const rating = Number(record?.rating)
  const updatedAt = Number(record?.updatedAt)
  if (!domainPattern.test(domain) || !Number.isInteger(rating) || rating < 0 || rating > 5 || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) return null
  return { domain, rating, updatedAt }
}
