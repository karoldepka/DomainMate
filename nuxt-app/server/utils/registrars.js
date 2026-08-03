/** @typedef {'exact'|'tld-list'} QuoteKind */
/** @typedef {{registrar: string, status: 'ok'|'unavailable'|'not-configured'|'error', currency?: string, registration?: number, renewal?: number, transfer?: number, quoteKind?: QuoteKind, premium?: boolean, url: string, message?: string}} RegistrarQuote */

const quoteCache = new Map()
const quoteCacheTtl = 15 * 60 * 1000
let porkbunPricingCache = null

/** @param {string} domain @returns {Promise<RegistrarQuote[]>} */
export async function compareRegistrarPrices(domain) {
  const cached = quoteCache.get(domain)
  if (cached && Date.now() - cached.savedAt < quoteCacheTtl) return cached.quotes
  const quotes = await Promise.all([quotePorkbun(domain), quoteGoDaddy(domain), quoteCloudflare(domain)])
  quoteCache.set(domain, { savedAt: Date.now(), quotes })
  return quotes
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
  if (!process.env.GODADDY_PAT) return notConfigured('GoDaddy', url)
  try {
    const data = await requestJson(`https://api.godaddy.com/v3/domains/check-availability?domain=${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${process.env.GODADDY_PAT}`, Accept: 'application/json' },
    })
    const annual = data.prices?.find((price) => price.term === 'YEAR' && price.period === 1) || data.prices?.[0]
    if (!data.available || !annual) return { registrar: 'GoDaddy', status: 'unavailable', url, message: 'Domain unavailable or unquoted.' }
    return {
      registrar: 'GoDaddy', status: 'ok', currency: annual.price.currencyCode,
      registration: Number(annual.price.value) / 100,
      renewal: annual.renewalPrice ? Number(annual.renewalPrice.value) / 100 : undefined,
      quoteKind: 'exact', premium: Boolean(data.premium), url,
    }
  } catch (error) { return errorQuote('GoDaddy', url, error) }
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
  if (porkbunPricingCache && Date.now() - porkbunPricingCache.savedAt < 60 * 60 * 1000) return porkbunPricingCache.pricing
  const data = await requestJson('https://api.porkbun.com/api/json/v3/pricing/get')
  if (data.status !== 'SUCCESS' || !data.pricing) throw new Error('Pricing unavailable.')
  porkbunPricingCache = { savedAt: Date.now(), pricing: data.pricing }
  return data.pricing
}

/** @param {string} url @param {RequestInit} [options] */
async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Registrar returned ${response.status}.`)
  return response.json()
}

function notConfigured(registrar, url) { return { registrar, status: 'not-configured', url, message: 'API credentials not configured.' } }
function errorQuote(registrar, url, error) { return { registrar, status: 'error', url, message: error instanceof Error ? error.message : 'Quote failed.' } }
