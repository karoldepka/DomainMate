import { isAiConfigured } from '../utils/ai.js'
import { getSearchProviderStatus } from '../utils/searchProviders.js'

export default defineEventHandler(() => {
  return { ok: true, search: getSearchProviderStatus(), ai: isAiConfigured(), build: useRuntimeConfig().public.build }
})
