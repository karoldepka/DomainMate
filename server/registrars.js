/** @typedef {'exact'|'tld-list'} QuoteKind */
/** @typedef {{registrar: string, status: 'ok'|'unavailable'|'not-configured'|'error', currency?: string, registration?: number, renewal?: number, transfer?: number, quoteKind?: QuoteKind, premium?: boolean, url: string, message?: string, retryAfterSeconds?: number}} RegistrarQuote */

const quoteCache = new Map()
const quoteRequests = new Map()
const quoteCacheTtl = 15 * 60 * 1000
const quoteErrorCacheTtl = 30 * 1000
const quoteCacheMax = 1000
const pricingCacheTtl = 60 * 60 * 1000
const providerCooldowns = new Map()
const providerRequestBuckets = new Map()
const providerRequestLimit = 50
const providerRequestWindowMs = 60 * 1000
let porkbunPricingCache = null
let porkbunPricingRequest = null
let nameSiloPricingCache = null
let nameSiloPricingRequest = null

/**
 * @param {string} domain
 * @param {(quote: RegistrarQuote) => void} [onQuote] Called as each provider settles, so callers can
 * render results progressively instead of waiting for every provider to respond.
 * @returns {Promise<RegistrarQuote[]>}
 */
export async function compareRegistrarPrices(domain, onQuote) {
  const emit = onQuote || (() => {})
  const cached = quoteCache.get(domain)
  if (cached && cached.expiresAt > Date.now()) {
    for (const quote of cached.quotes) emit(quote)
    return cached.quotes
  }
  if (cached) quoteCache.delete(domain)

  const pending = quoteRequests.get(domain)
  if (pending) {
    const quotes = await pending
    for (const quote of quotes) emit(quote)
    return quotes
  }

  const providerPromises = [
    quotePorkbun(domain),
    quoteGoDaddy(domain),
    quoteDynadot(domain),
    quoteNameSilo(domain),
    quoteCloudflare(domain),
  ]
  for (const providerPromise of providerPromises) providerPromise.then(emit)

  const request = Promise.all(providerPromises).then((quotes) => {
    const retryAfterMs = Math.max(0, ...quotes.map((quote) => Number(quote.retryAfterSeconds || 0) * 1000))
    const ttl = quotes.some((quote) => quote.status === 'error') ? Math.max(quoteErrorCacheTtl, retryAfterMs) : quoteCacheTtl
    setBoundedQuoteCache(domain, { expiresAt: Date.now() + ttl, quotes })
    return quotes
  }).finally(() => quoteRequests.delete(domain))

  quoteRequests.set(domain, request)
  return request
}

/** Public TLD list pricing; premium-name pricing is not reflected. */
async function quotePorkbun(domain) {
  const url = `https://porkbun.com/checkout/search?q=${encodeURIComponent(domain)}`
  try {
    const pricing = await getPorkbunPricing()
    const tld = Object.keys(pricing).filter((item) => domain.endsWith(`.${item}`)).sort((a, b) => b.length - a.length)[0]
    const price = pricing[tld]
    if (!price) return { registrar: 'Porkbun', status: 'unavailable', url, message: 'Extension not listed.' }
    return {
      registrar: 'Porkbun', status: 'ok', currency: 'USD',
      registration: Number(price.registration), renewal: Number(price.renewal), transfer: Number(price.transfer),
      quoteKind: 'tld-list', url,
    }
  } catch (error) { return errorQuote('Porkbun', url, error) }
}

/** Domain-specific GoDaddy quote through the Domains v3 API. */
async function quoteGoDaddy(domain) {
  const url = `https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(domain)}`
  const authorization = getGoDaddyAuthorization()
  if (!authorization) return notConfigured('GoDaddy', url)
  try {
    const params = new URLSearchParams({ domain, optimizeFor: 'ACCURACY' })
    const data = await requestJson(`https://api.godaddy.com/v3/domains/check-availability?${params}`, {
      headers: { Authorization: authorization, Accept: 'application/json' },
    })
    const annual = data.prices?.find((price) => price.term === 'YEAR' && price.period === 1) || data.prices?.[0]
    if (!data.available || !annual) return { registrar: 'GoDaddy', status: 'unavailable', url, message: 'Domain unavailable or unquoted.' }
    return {
      registrar: 'GoDaddy', status: 'ok', currency: annual.price.currencyCode,
      registration: Number(annual.price.value) / 100,
      renewal: annual.renewalPrice ? Number(annual.renewalPrice.value) / 100 : undefined,
      quoteKind: 'exact', premium: isPremiumInventory(data.inventory), url,
    }
  } catch (error) { return errorQuote('GoDaddy', url, error) }
}

/** Domain-specific Dynadot registration quote through its search API. */
async function quoteDynadot(domain) {
  const url = `https://www.dynadot.com/domain/search.html?domain=${encodeURIComponent(domain)}`
  const apiKey = process.env.DYNADOT_API_KEY
  if (!apiKey) return notConfigured('Dynadot', url)
  try {
    const params = new URLSearchParams({
      key: apiKey,
      command: 'search',
      domain0: domain,
      show_price: '1',
      currency: 'USD',
    })
    const data = await requestJson(`https://api.dynadot.com/api3.json?${params}`)
    const response = data.SearchResponse
    if (String(response?.ResponseCode) !== '0') {
      throw new Error(response?.Error || data.Response?.Error || 'Pricing unavailable.')
    }
    const results = Array.isArray(response.SearchResults) ? response.SearchResults : [response.SearchResults]
    const result = results.find((item) => item?.DomainName?.toLowerCase() === domain)
    if (String(result?.Available).toLowerCase() !== 'yes') {
      return { registrar: 'Dynadot', status: 'unavailable', url, message: 'Domain unavailable or unquoted.' }
    }
    const price = parseDynadotPrice(result.Price)
    if (!price) throw new Error('Registration price was not returned.')
    return {
      registrar: 'Dynadot', status: 'ok', ...price,
      quoteKind: 'exact', url,
    }
  } catch (error) { return errorQuote('Dynadot', url, error) }
}

/** NameSilo retail TLD list pricing; premium-name pricing is not reflected. */
async function quoteNameSilo(domain) {
  const url = `https://www.namesilo.com/domain/search-domains?query=${encodeURIComponent(domain)}`
  if (!process.env.NAMESILO_API_KEY) return notConfigured('NameSilo', url)
  try {
    const price = extractNameSiloPrice(domain, await getNameSiloPricing())
    if (!price) return { registrar: 'NameSilo', status: 'unavailable', url, message: 'Extension not listed.' }
    return { registrar: 'NameSilo', status: 'ok', currency: 'USD', ...price, quoteKind: 'tld-list', url }
  } catch (error) { return errorQuote('NameSilo', url, error) }
}

/** Real-time Cloudflare Registrar registry quote. */
async function quoteCloudflare(domain) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_REGISTRAR_TOKEN
  const url = accountId ? `https://dash.cloudflare.com/${accountId}/domains/registrations` : 'https://dash.cloudflare.com/'
  if (!accountId || !token) return notConfigured('Cloudflare', url)
  try {
    const data = await requestJson(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/registrar/domain-check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: [domain] }),
    })
    const result = data.result?.domains?.find((item) => item.name === domain)
    if (!result?.registrable || !result.pricing) return { registrar: 'Cloudflare', status: 'unavailable', url, message: result?.reason || 'No quote.' }
    return {
      registrar: 'Cloudflare', status: 'ok', currency: result.pricing.currency,
      registration: Number(result.pricing.registration_cost), renewal: Number(result.pricing.renewal_cost),
      quoteKind: 'exact', premium: result.tier === 'premium', url,
    }
  } catch (error) { return errorQuote('Cloudflare', url, error) }
}

async function getPorkbunPricing() {
  if (porkbunPricingCache && Date.now() - porkbunPricingCache.savedAt < pricingCacheTtl) return porkbunPricingCache.pricing
  if (porkbunPricingRequest) return porkbunPricingRequest
  porkbunPricingRequest = requestJson('https://api.porkbun.com/api/json/v3/pricing/get').then((data) => {
    if (data.status !== 'SUCCESS' || !data.pricing) throw new Error('Pricing unavailable.')
    porkbunPricingCache = { savedAt: Date.now(), pricing: data.pricing }
    return data.pricing
  }).finally(() => { porkbunPricingRequest = null })
  return porkbunPricingRequest
}

async function getNameSiloPricing() {
  if (nameSiloPricingCache && Date.now() - nameSiloPricingCache.savedAt < pricingCacheTtl) return nameSiloPricingCache.pricing
  if (nameSiloPricingRequest) return nameSiloPricingRequest
  const params = new URLSearchParams({ version: '1', type: 'json', key: String(process.env.NAMESILO_API_KEY), retail_prices: '1' })
  nameSiloPricingRequest = requestJson(`https://www.namesilo.com/api/getPrices?${params}`).then((data) => {
    if (Number(data.reply?.code) !== 300) throw new Error(data.reply?.detail || 'Pricing unavailable.')
    nameSiloPricingCache = { savedAt: Date.now(), pricing: data.reply }
    return nameSiloPricingCache.pricing
  }).finally(() => { nameSiloPricingRequest = null })
  return nameSiloPricingRequest
}

/**
 * Build the bearer authorization required by GoDaddy's Domains v3 API.
 * @param {Record<string, string|undefined>} [environment]
 */
export function getGoDaddyAuthorization(environment = process.env) {
  if (environment.GODADDY_PAT) return `Bearer ${environment.GODADDY_PAT}`
  return ''
}

/**
 * Normalize NameSilo's per-TLD retail price object for one domain.
 * @param {string} domain
 * @param {Record<string, unknown>} pricing
 * @returns {{registration: number, renewal: number|undefined, transfer: number|undefined}|null}
 */
export function extractNameSiloPrice(domain, pricing) {
  const candidates = Object.keys(pricing).filter((item) => pricing[item] && typeof pricing[item] === 'object')
  const tld = findMatchingTld(domain, candidates)
  const value = pricing[tld]
  if (!value || typeof value !== 'object') return null
  const registration = normalizePrice(value.registration)
  if (registration === undefined) return null
  return {
    registration,
    renewal: normalizePrice(value.renew),
    transfer: normalizePrice(value.transfer),
  }
}

/**
 * Parse Dynadot's live search-price representation, e.g. "Registration Price: 8.00 in
 * USD and Renewal price: 12.50 in USD and Domain is not a Premium Domain".
 * @param {unknown} value
 * @returns {{registration: number, currency: string, renewal?: number, premium: boolean}|null}
 */
export function parseDynadotPrice(value) {
  const source = String(value || '').trim()
  const match = source.match(
    /^Registration Price:\s*([\d,.]+)\s+in\s+([a-z]{3})\s+and\s+Renewal price:\s*([\d,.]+)\s+in\s+[a-z]{3}\s+and\s+Domain is (not\s+)?a Premium Domain$/i,
  )
  if (!match) return null
  const registration = Number(match[1].replace(/,/g, ''))
  const renewal = Number(match[3].replace(/,/g, ''))
  if (!Number.isFinite(registration)) return null
  return {
    registration,
    currency: match[2].toUpperCase(),
    ...(Number.isFinite(renewal) ? { renewal } : {}),
    premium: !match[4],
  }
}

/** @param {unknown} inventory */
export function isPremiumInventory(inventory) {
  return ['REGISTRY_PREMIUM', 'PREMIUM'].includes(String(inventory || '').toUpperCase())
}

/** Keep domain-specific cache memory bounded in long-running server processes. */
function setBoundedQuoteCache(domain, value) {
  if (quoteCache.size >= quoteCacheMax) quoteCache.delete(quoteCache.keys().next().value)
  quoteCache.set(domain, value)
}

/** @param {string} domain @param {string[]} candidates @returns {string|undefined} */
function findMatchingTld(domain, candidates) {
  return candidates
    .map((source) => ({ source, normalized: source.replace(/^\./, '').toLowerCase() }))
    .filter(({ normalized }) => normalized && domain.endsWith(`.${normalized}`))
    .sort((a, b) => b.normalized.length - a.normalized.length)[0]?.source
}

/** @param {unknown} value @returns {number|undefined} */
function normalizePrice(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return undefined
  const price = Number(value)
  return Number.isFinite(price) && price >= 0 ? price : undefined
}

/** @param {string} url @param {RequestInit} [options] */
async function requestJson(url, options = {}) {
  const provider = new URL(url).hostname
  const cooldownRemaining = Math.ceil(((providerCooldowns.get(provider) || 0) - Date.now()) / 1000)
  if (cooldownRemaining > 0) throw createRateLimitError(cooldownRemaining)
  enforceProviderRequestBudget(provider)
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) })
  if (response.status === 429) {
    const retryAfter = getRetryAfterSeconds(response.headers) || 60
    providerCooldowns.set(provider, Date.now() + retryAfter * 1000)
    throw createRateLimitError(retryAfter)
  }
  if (!response.ok) throw new Error(`Registrar returned ${response.status}.`)
  return response.json()
}

/** Convert Retry-After seconds or an HTTP date to a bounded, non-negative hint. @param {Headers} headers */
function getRetryAfterSeconds(headers) {
  const value = headers?.get?.('retry-after')
  if (!value) return 0
  const seconds = Number(value)
  const parsed = Number.isFinite(seconds) ? seconds : (Date.parse(value) - Date.now()) / 1000
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(86400, Math.ceil(parsed))
}

/** @param {number} retryAfterSeconds */
function createRateLimitError(retryAfterSeconds) {
  const error = new Error(`Registrar rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`)
  error.retryAfterSeconds = retryAfterSeconds
  return error
}

/** Consume one real upstream request from the credential-wide provider budget. @param {string} provider */
function enforceProviderRequestBudget(provider) {
  const now = Date.now()
  let bucket = providerRequestBuckets.get(provider)
  if (!bucket || now - bucket.windowStart >= providerRequestWindowMs) {
    bucket = { windowStart: now, count: 0 }
    providerRequestBuckets.set(provider, bucket)
  }
  if (bucket.count >= providerRequestLimit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.windowStart + providerRequestWindowMs - now) / 1000))
    throw createRateLimitError(retryAfter)
  }
  bucket.count += 1
}

function notConfigured(registrar, url) { return { registrar, status: 'not-configured', url, message: 'API credentials not configured.' } }
function errorQuote(registrar, url, error) {
  return {
    registrar, status: 'error', url,
    message: error instanceof Error ? error.message : 'Quote failed.',
    ...(Number.isFinite(error?.retryAfterSeconds) ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
  }
}
