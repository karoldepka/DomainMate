/** @typedef {{name: string, url: string}} RegistrarLink */
/** @typedef {{name: string, buildUrl: (domain: string) => string}} RegistrarDefinition */

/** @type {RegistrarDefinition[]} */
const registrarDefinitions = [
  { name: 'GoDaddy', buildUrl: (domain) => withQuery('https://www.godaddy.com/domainsearch/find', 'domainToCheck', domain) },
  { name: 'Namecheap', buildUrl: (domain) => withQuery('https://www.namecheap.com/domains/registration/results/', 'domain', domain) },
  { name: 'Squarespace Domains', buildUrl: (domain) => withQuery('https://domains.squarespace.com/domain-search', 'query', domain) },
  { name: 'Hover', buildUrl: (domain) => withQuery('https://www.hover.com/domains/results', 'q', domain) },
  { name: 'Dynadot', buildUrl: (domain) => withQuery('https://www.dynadot.com/domain/search', 'domain', domain) },
  { name: 'Hostinger', buildUrl: (domain) => withQuery('https://www.hostinger.com/domain-name-search', 'domain', domain) },
  { name: 'IONOS', buildUrl: (domain) => withQuery('https://www.ionos.com/domains/domain-names', 'domain', domain) },
  { name: 'NameSilo', buildUrl: (domain) => withQuery('https://www.namesilo.com/domain/search-domains', 'query', domain) },
  { name: 'Name.com', buildUrl: (domain) => `https://www.name.com/domain/search/${encodeURIComponent(domain)}` },
  { name: 'Porkbun', buildUrl: (domain) => withQuery('https://porkbun.com/checkout/search', 'q', domain) },
]

/**
 * Build non-affiliate registrar searches for one fully qualified domain name.
 * @param {string} domain
 * @returns {RegistrarLink[]}
 */
export function getRegistrarLinks(domain) {
  const normalized = domain.trim().toLowerCase()
  return registrarDefinitions.map((registrar) => ({ name: registrar.name, url: registrar.buildUrl(normalized) }))
}

/** @param {string} base @param {string} key @param {string} domain */
function withQuery(base, key, domain) {
  const url = new URL(base)
  url.searchParams.set(key, domain)
  return url.toString()
}
