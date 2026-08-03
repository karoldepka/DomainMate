let model

/** Defer LangChain's (heavy) import until a request actually needs it. @returns {Promise<import('@langchain/anthropic').ChatAnthropic|null>} */
async function getModel() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!model) {
    const { ChatAnthropic } = await import('@langchain/anthropic')
    model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-haiku-latest',
      temperature: 0.8,
      maxTokens: 200,
    })
  }
  return model
}

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Ask an LLM for short, brandable words related to the seed word, alongside Datamuse.
 * @param {string} word
 * @param {number} maxSyllables
 * @returns {Promise<string[]>}
 */
export async function suggestSimilarWords(word, maxSyllables) {
  const chat = getModel()
  if (!chat) return []
  try {
    const response = await chat.invoke([
      new SystemMessage(
        'You generate short brandable English word alternatives for startup domain naming. ' +
        'Reply with ONLY a compact JSON array of lowercase words, no prose, no markdown fences, no explanation.',
      ),
      new HumanMessage(
        `Seed word: "${word}". Give 5 short (at most ${maxSyllables} syllables), brandable, real or plausibly ` +
        `invented English words that start with the same first letter as "${word}" and evoke a related meaning ` +
        'or sound, suitable as part of a tech startup name. JSON array of strings only.',
      ),
    ], { signal: AbortSignal.timeout(9000) })
    const text = String(response.content).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => String(item).toLowerCase().replace(/[^a-z]/g, ''))
      .filter((item) => item.length >= 3 && item.length <= 12)
  } catch {
    return []
  }
}
