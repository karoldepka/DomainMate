/**
 * Resolve registration status through the TLD's authoritative RDAP service.
 * @param {string} domain
 * @returns {Promise<{availability: string, availabilityNote?: string}>}
 */
export async function checkDomain(domain) {
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
