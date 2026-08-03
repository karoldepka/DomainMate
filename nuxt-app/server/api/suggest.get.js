import { suggestSimilarWords } from '../utils/ai.js'
import { wordPattern } from '../utils/validation.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const word = String(query.word || '').trim().toLowerCase()
  const maxSyllables = Math.min(8, Math.max(1, Number(query.maxSyllables) || 3))
  if (!wordPattern.test(word)) {
    setResponseStatus(event, 400)
    return { error: 'Enter a valid word.' }
  }
  return { words: await suggestSimilarWords(word, maxSyllables) }
})
