import { flags } from '../featureFlags.js'

/** @typedef {{domain: string, rating: number, updatedAt: number}} FavoriteRecord */

const databaseName = 'domainmate'
const databaseVersion = 1
let databasePromise
let clientIdPromise

/** Open the browser database once and provision favorites and metadata stores. */
function openDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('favorites')) database.createObjectStore('favorites', { keyPath: 'domain' })
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return databasePromise
}

/** @returns {Promise<string>} */
export async function getClientId() {
  if (clientIdPromise) return clientIdPromise
  clientIdPromise = (async () => {
    const existing = await getValue('meta', 'clientId')
    if (typeof existing === 'string') return existing
    const created = crypto.randomUUID()
    await putValue('meta', created, 'clientId')
    return created
  })()
  return clientIdPromise
}

/** Hydrate IndexedDB, and reconcile with the server only when cloud sync is enabled. */
export async function loadAndSyncFavorites() {
  await migrateLegacyFavorites()
  const records = await getAllFavorites()
  if (!flags.favoritesSync) return new Map(records.map((record) => [record.domain, record.rating]))
  try {
    const clientId = await getClientId()
    const response = await fetch('/api/favorites/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, records }),
    })
    if (!response.ok) throw new Error('Favorite sync failed')
    const data = await response.json()
    await replaceFavorites(data.records || [])
    return new Map(data.records.map((record) => [record.domain, record.rating]))
  } catch {
    return new Map(records.map((record) => [record.domain, record.rating]))
  }
}

/** Persist a user rating locally, then sync to the server only when cloud sync is enabled. */
export async function saveRating(domain, rating) {
  /** @type {FavoriteRecord} */
  const record = { domain, rating, updatedAt: Date.now() }
  await putValue('favorites', record)
  if (!flags.favoritesSync) return
  try {
    const clientId = await getClientId()
    await fetch('/api/favorites/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, records: [record] }),
      keepalive: true,
    })
  } catch { /* The next hydration retries IndexedDB records. */ }
}

/** Move favorites from the previous localStorage implementation once, as a top rating. */
async function migrateLegacyFavorites() {
  try {
    const legacy = JSON.parse(localStorage.getItem('domainmate.favorites') || '[]')
    if (Array.isArray(legacy)) {
      const savedAt = Date.now()
      await Promise.all(legacy.filter((domain) => typeof domain === 'string').map((domain) =>
        putValue('favorites', { domain, rating: 5, updatedAt: savedAt })))
    }
    localStorage.removeItem('domainmate.favorites')
  } catch { /* Ignore malformed legacy storage. */ }
}

/** @returns {Promise<FavoriteRecord[]>} */
async function getAllFavorites() {
  const database = await openDatabase()
  const records = await requestResult(database.transaction('favorites').objectStore('favorites').getAll())
  return records.map(normalizeStoredRecord)
}

/** Upgrade a record stored under the previous boolean `starred` shape. */
function normalizeStoredRecord(record) {
  if (typeof record.rating === 'number') return record
  return { domain: record.domain, rating: record.starred ? 5 : 0, updatedAt: record.updatedAt }
}

/** @param {FavoriteRecord[]} records */
async function replaceFavorites(records) {
  const database = await openDatabase()
  const transaction = database.transaction('favorites', 'readwrite')
  const store = transaction.objectStore('favorites')
  store.clear()
  for (const record of records) store.put(record)
  await transactionDone(transaction)
}

/** @param {string} storeName @param {IDBValidKey} key */
async function getValue(storeName, key) {
  const database = await openDatabase()
  return requestResult(database.transaction(storeName).objectStore(storeName).get(key))
}

/** @param {string} storeName @param {unknown} value @param {IDBValidKey} [key] */
async function putValue(storeName, value, key) {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  key === undefined ? transaction.objectStore(storeName).put(value) : transaction.objectStore(storeName).put(value, key)
  await transactionDone(transaction)
}

/** @param {IDBRequest} request */
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** @param {IDBTransaction} transaction */
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
