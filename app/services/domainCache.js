const databaseName = 'domainmate-cache'
const databaseVersion = 2
const cacheTtl = 15 * 60 * 1000
const priceCacheTtl = 15 * 60 * 1000
let databasePromise

/** Open the browser database once and provision the lookup and price cache stores. */
function openDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('lookups')) database.createObjectStore('lookups', { keyPath: 'key' })
      if (!database.objectStoreNames.contains('prices')) database.createObjectStore('prices', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return databasePromise
}

/** @param {string} domain @param {string} keywords */
export async function readCachedLookup(domain, keywords) {
  try {
    const database = await openDatabase()
    const entry = await requestResult(database.transaction('lookups').objectStore('lookups').get(`${domain}|${keywords}`))
    return entry && Date.now() - entry.savedAt < cacheTtl ? entry.data : null
  } catch { return null }
}

/** @param {string} domain @param {string} keywords @param {object} data */
export async function writeCachedLookup(domain, keywords, data) {
  try {
    const database = await openDatabase()
    const transaction = database.transaction('lookups', 'readwrite')
    transaction.objectStore('lookups').put({ key: `${domain}|${keywords}`, savedAt: Date.now(), data })
    await transactionDone(transaction)
  } catch { /* Storage can be unavailable in privacy modes. */ }
}

/** @param {string} domain @returns {Promise<{savedAt: number, quotes: object[]}|null>} */
export async function readCachedPrices(domain) {
  try {
    const database = await openDatabase()
    const entry = await requestResult(database.transaction('prices').objectStore('prices').get(domain))
    return entry && Date.now() - entry.savedAt < priceCacheTtl ? entry : null
  } catch { return null }
}

/** @param {string} domain @param {object[]} quotes */
export async function writeCachedPrices(domain, quotes) {
  try {
    const database = await openDatabase()
    const transaction = database.transaction('prices', 'readwrite')
    transaction.objectStore('prices').put({ key: domain, savedAt: Date.now(), quotes })
    await transactionDone(transaction)
  } catch { /* Storage can be unavailable in privacy modes. */ }
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
