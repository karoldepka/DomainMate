import assert from 'node:assert/strict'
import test from 'node:test'
import en from '../src/i18n/locales/en.js'
import pl from '../src/i18n/locales/pl.js'
import es from '../src/i18n/locales/es.js'
import ca from '../src/i18n/locales/ca.js'
import pt from '../src/i18n/locales/pt.js'
import fr from '../src/i18n/locales/fr.js'
import it from '../src/i18n/locales/it.js'
import de from '../src/i18n/locales/de.js'
import zh from '../src/i18n/locales/zh.js'

const dictionaries = { en, pl, es, ca, pt, fr, it, de, zh }

/** @param {object} value @param {string} [prefix] @returns {string[]} */
function flattenKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return item && typeof item === 'object' && !Array.isArray(item) ? flattenKeys(item, path) : [path]
  })
}

test('every locale defines exactly the same keys as English', () => {
  const englishKeys = new Set(flattenKeys(en))
  for (const [name, dictionary] of Object.entries(dictionaries)) {
    if (name === 'en') continue
    const keys = new Set(flattenKeys(dictionary))
    const missing = [...englishKeys].filter((key) => !keys.has(key))
    const extra = [...keys].filter((key) => !englishKeys.has(key))
    assert.deepEqual(missing, [], `${name}.js is missing keys present in en.js`)
    assert.deepEqual(extra, [], `${name}.js has keys not present in en.js`)
  }
})

test('interpolation placeholders match between English and every translation', () => {
  const placeholdersOf = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  const englishEntries = flattenKeys(en).map((path) => [path, path.split('.').reduce((node, key) => node[key], en)])
  for (const [path, englishText] of englishEntries) {
    if (typeof englishText !== 'string') continue
    const expected = placeholdersOf(englishText)
    if (!expected.length) continue
    for (const [name, dictionary] of Object.entries(dictionaries)) {
      if (name === 'en') continue
      const translated = path.split('.').reduce((node, key) => node?.[key], dictionary)
      if (typeof translated !== 'string') continue
      assert.deepEqual(placeholdersOf(translated), expected, `${name}.js "${path}" placeholders differ from English`)
    }
  }
})
