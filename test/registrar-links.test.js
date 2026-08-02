import assert from 'node:assert/strict'
import test from 'node:test'
import { getRegistrarLinks } from '../src/services/registrarLinks.js'

test('builds ten unique HTTPS registrar searches for the selected domain', () => {
  const domain = 'innotopic.ai'
  const links = getRegistrarLinks(domain)

  assert.equal(links.length, 10)
  assert.equal(new Set(links.map((link) => link.name)).size, 10)
  for (const link of links) {
    assert.equal(new URL(link.url).protocol, 'https:')
    assert.match(decodeURIComponent(link.url), new RegExp(domain.replace('.', '\\.')))
  }
})
