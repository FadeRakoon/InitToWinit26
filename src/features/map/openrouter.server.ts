import { createOpenAI } from '@ai-sdk/openai'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

function buildOpenRouterHeaders() {
  const headers: Record<string, string> = {}
  const httpReferer = process.env.OPENROUTER_HTTP_REFERER?.trim()
  const appTitle = process.env.OPENROUTER_APP_TITLE?.trim()

  if (httpReferer) {
    headers['HTTP-Referer'] = httpReferer
  }

  if (appTitle) {
    headers['X-Title'] = appTitle
  }

  return headers
}

export function resolveOpenRouterModel() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  const modelName = process.env.OPENROUTER_MODEL?.trim()

  if (!apiKey || !modelName) {
    return null
  }

  const openrouter = createOpenAI({
    name: 'openrouter',
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    headers: buildOpenRouterHeaders(),
  })

  return openrouter.chat(modelName)
}
