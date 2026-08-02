import { ref, watch } from 'vue'
import en from './locales/en.js'
import pl from './locales/pl.js'
import es from './locales/es.js'
import ca from './locales/ca.js'
import pt from './locales/pt.js'
import fr from './locales/fr.js'
import it from './locales/it.js'
import de from './locales/de.js'
import zh from './locales/zh.js'

const dictionaries = { en, pl, es, ca, pt, fr, it, de, zh }
const storageKey = 'domainmate.locale'

export const locales = [
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polski' },
  { code: 'es', label: 'Español' },
  { code: 'ca', label: 'Català' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '中文' },
]

/** Pick a stored preference, then the closest supported browser language, then English. */
function detectLocale() {
  const stored = localStorage.getItem(storageKey)
  if (stored && dictionaries[stored]) return stored
  const browser = (navigator.language || 'en').toLowerCase().split('-')[0]
  return dictionaries[browser] ? browser : 'en'
}

export const locale = ref(detectLocale())

watch(locale, (value) => localStorage.setItem(storageKey, value))

/** Look up a dot-separated key, falling back to English, then the key itself. */
export function t(path, vars) {
  const template = resolve(dictionaries[locale.value], path) ?? resolve(dictionaries.en, path) ?? path
  if (!vars) return template
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template)
}

/** @param {object} dict @param {string} path */
function resolve(dict, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), dict)
}
