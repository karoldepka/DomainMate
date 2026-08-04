/** @typedef {'exact'|'estimated'|'returned'} CountKind */
/** @typedef {{provider: string, status: 'ok'|'error'|'not-configured', query: string, totalResults?: number, countKind?: CountKind, message?: string}} NormalizedSearchResult */
/** @typedef {{search(query: string): Promise<NormalizedSearchResult>, isConfigured(): boolean, name: string}} SearchProvider */

const timeoutMs = 9000

/** @returns {SearchProvider} */
function createGoogleProvider() {
  return {
    name: 'google',
    isConfigured: () => Boolean(process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID),
    async search(query) {
      if (!this.isConfigured()) return notConfigured(this.name, query, 'GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID are required.')
      const params = new URLSearchParams({ key: process.env.GOOGLE_API_KEY, cx: process.env.GOOGLE_SEARCH_ENGINE_ID, q: query, num: '1' })
      const data = await requestJson(`https://www.googleapis.com/customsearch/v1?${params}`)
      return { provider: this.name, status: 'ok', query, totalResults: Number(data.searchInformation?.totalResults || 0), countKind: 'estimated' }
    },
  }
}

/** @returns {SearchProvider} */
function createSerperProvider() {
  return {
    name: 'serper',
    isConfigured: () => Boolean(process.env.SERPER_API_KEY),
    async search(query) {
      if (!this.isConfigured()) return notConfigured(this.name, query, 'SERPER_API_KEY is required.')
      const data = await requestJson('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 10 }),
      })
      const reported = data.searchInformation?.totalResults
      const returned = Array.isArray(data.organic) ? data.organic.length : 0
      return { provider: this.name, status: 'ok', query, totalResults: Number.isFinite(Number(reported)) ? Number(reported) : returned, countKind: reported == null ? 'returned' : 'estimated' }
    },
  }
}

/** @returns {SearchProvider} */
function createTavilyProvider() {
  return {
    name: 'tavily',
    isConfigured: () => Boolean(process.env.TAVILY_API_KEY),
    async search(query) {
      if (!this.isConfigured()) return notConfigured(this.name, query, 'TAVILY_API_KEY is required.')
      const data = await requestJson('https://api.tavily.com/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, search_depth: 'basic', max_results: 20, include_answer: false }),
      })
      return { provider: this.name, status: 'ok', query, totalResults: Array.isArray(data.results) ? data.results.length : 0, countKind: 'returned' }
    },
  }
}

const providers = {
  google: createGoogleProvider(),
  serper: createSerperProvider(),
  tavily: createTavilyProvider(),
}

/**
 * Return the selected provider. In auto mode the first configured provider wins.
 * @param {string} [requested]
 * @returns {SearchProvider}
 */
export function getSearchProvider(requested = process.env.SEARCH_PROVIDER || 'auto') {
  const key = requested.toLowerCase()
  if (key !== 'auto' && providers[key]) return providers[key]
  return Object.values(providers).find((provider) => provider.isConfigured()) || providers.serper
}

/** @returns {{selected: string, configured: string[]}} */
export function getSearchProviderStatus() {
  const provider = getSearchProvider()
  return { selected: provider.name, configured: Object.values(providers).filter((item) => item.isConfigured()).map((item) => item.name) }
}

/**
 * Search for a domain through the configured normalized provider.
 * @param {string} domain
 * @param {string} keywords
 * @returns {Promise<{status: string, query: string, totalResults?: number}>}
 */
export async function checkSearch(domain, keywords) {
  const query = keywords ? `"${domain}" ${keywords}` : `"${domain}"`
  try {
    return await getSearchProvider().search(query)
  } catch (error) {
    return { provider: getSearchProvider().name, status: 'error', query, message: error instanceof Error ? error.message : 'Search failed.' }
  }
}

/** @param {string} provider @param {string} query @param {string} message @returns {NormalizedSearchResult} */
function notConfigured(provider, query, message) {
  return { provider, status: 'not-configured', query, message }
}

/** @param {string} url @param {RequestInit} [options] */
async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`Search provider returned ${response.status}.`)
  return response.json()
}

