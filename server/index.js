import 'dotenv/config'
import express from 'express'
import { getSearchProvider, getSearchProviderStatus } from './searchProviders.js'
import { createCheckout, creditPacks, PaymentError, verifyCheckout } from './payments.js'
import { syncFavorites } from './favorites.js'
import { compareRegistrarPrices } from './registrars.js'
import { isAiConfigured, suggestSimilarWords } from './ai.js'

const app = express()
const port = Number(process.env.PORT) || 8787
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const wordPattern = /^[a-z]{2,20}$/

app.use(express.json())

app.post('/api/favorites/sync', (req, res) => {
  const clientId = String(req.body?.clientId || '')
  const records = Array.isArray(req.body?.records) ? req.body.records : []
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: 'Invalid client ID.' })
  if (records.length > 1000) return res.status(400).json({ error: 'Too many favorite records.' })
  const normalized = records.map(normalizeFavorite).filter(Boolean)
  if (normalized.length !== records.length) return res.status(400).json({ error: 'Invalid favorite record.' })
  res.json({ records: syncFavorites(clientId, normalized) })
})

app.get('/api/registrars/compare', async (req, res) => {
  const domain = String(req.query.domain || '').trim().toLowerCase()
  if (!domainPattern.test(domain)) return res.status(400).json({ error: 'Enter a valid domain name.' })
  res.json({ domain, quotes: await compareRegistrarPrices(domain) })
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

app.listen(port, () => {
  console.log(`DomainMate API listening on http://localhost:${port}`)
})

/** Only return known local or explicitly configured origins for Stripe redirects. */
function getAllowedOrigin(req) {
  const configured = process.env.APP_URL?.replace(/\/$/, '')
  if (configured) return configured
  const origin = String(req.headers.origin || '')
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
  throw new PaymentError('Set APP_URL before accepting production payments.', 400)
}

/** Validate untrusted browser synchronization records. */
function normalizeFavorite(record) {
  const domain = String(record?.domain || '').toLowerCase()
  const rating = Number(record?.rating)
  const updatedAt = Number(record?.updatedAt)
  if (!domainPattern.test(domain) || !Number.isInteger(rating) || rating < 0 || rating > 5 || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) return null
  return { domain, rating, updatedAt }
}
