const cacheDuration = 24 * 60 * 60 * 1000
let cachedTlds = null
let cacheExpiresAt = 0

/** Return the current IANA root-zone labels, with a short in-memory cache. */
export default defineEventHandler(async () => {
  if (cachedTlds && Date.now() < cacheExpiresAt) return { tlds: cachedTlds }

  try {
    const response = await fetch('https://data.iana.org/TLD/tlds-alpha-by-domain.txt', {
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`IANA returned ${response.status}`)
    const text = await response.text()
    const tlds = [...new Set(text
      .split(/\r?\n/)
      .filter(line => line && !line.startsWith('#'))
      .map(line => line.trim().toLowerCase())
      .filter(tld => /^[a-z0-9-]{2,63}$/.test(tld)))]
      .sort((left, right) => left.localeCompare(right))
    if (!tlds.length) throw new Error('IANA returned no usable TLDs')
    cachedTlds = tlds
    cacheExpiresAt = Date.now() + cacheDuration
    return { tlds }
  } catch {
    // Keep the selector useful when IANA is temporarily unreachable.
    return { tlds: ['ai', 'app', 'co', 'com', 'dev', 'io', 'net', 'org', 'tech', 'xyz'] }
  }
})
