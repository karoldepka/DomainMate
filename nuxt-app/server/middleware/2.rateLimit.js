const rateLimitWindowMs = 60_000
const rateLimitMax = 300
const registrarRateLimitMax = 50
const rateLimitBuckets = new Map()
const registrarRateLimitBuckets = new Map()

/** Cap requests per client IP to protect upstream RDAP/DNS/search/AI quotas from abuse. */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/')) return

  const now = Date.now()
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const apiLimit = consumeRateLimit(rateLimitBuckets, ip, rateLimitMax, now)
  if (!apiLimit.allowed) {
    setResponseStatus(event, 429)
    setResponseHeader(event, 'Retry-After', String(apiLimit.retryAfter))
    return { error: 'Too many requests. Please slow down.' }
  }

  if (event.path.startsWith('/api/registrars/compare')) {
    const registrarLimit = consumeRateLimit(registrarRateLimitBuckets, ip, registrarRateLimitMax, now)
    setResponseHeader(event, 'X-RateLimit-Limit', String(registrarRateLimitMax))
    setResponseHeader(event, 'X-RateLimit-Remaining', String(registrarLimit.remaining))
    setResponseHeader(event, 'X-RateLimit-Reset', String(registrarLimit.retryAfter))
    if (!registrarLimit.allowed) {
      setResponseStatus(event, 429)
      setResponseHeader(event, 'Retry-After', String(registrarLimit.retryAfter))
      return { error: 'Too many price comparisons. Please retry shortly.' }
    }
  }
})

/** @param {Map<string, {windowStart: number, count: number}>} buckets */
function consumeRateLimit(buckets, key, maximum, now) {
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
