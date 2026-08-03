const rateLimitWindowMs = 60_000
const rateLimitMax = 300
const rateLimitBuckets = new Map()

/** Cap requests per client IP to protect upstream RDAP/DNS/search/AI quotas from abuse. */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/')) return

  const now = Date.now()
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const bucket = rateLimitBuckets.get(ip)
  if (!bucket || now - bucket.windowStart > rateLimitWindowMs) {
    rateLimitBuckets.set(ip, { windowStart: now, count: 1 })
    return
  }
  bucket.count += 1
  if (bucket.count > rateLimitMax) {
    setResponseStatus(event, 429)
    return { error: 'Too many requests. Please slow down.' }
  }
})

setInterval(() => {
  const cutoff = Date.now() - rateLimitWindowMs
  for (const [key, bucket] of rateLimitBuckets) if (bucket.windowStart < cutoff) rateLimitBuckets.delete(key)
}, rateLimitWindowMs).unref()
