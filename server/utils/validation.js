export const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
export const wordPattern = /^[a-z]{2,20}$/

/** Validate untrusted browser synchronization records. */
export function normalizeFavorite(record) {
  const domain = String(record?.domain || '').toLowerCase()
  const rating = Number(record?.rating)
  const comment = String(record?.comment || '').slice(0, 2000)
  const updatedAt = Number(record?.updatedAt)
  if (!domainPattern.test(domain) || !Number.isInteger(rating) || rating < 0 || rating > 5 || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) return null
  return { domain, rating, comment, updatedAt }
}
