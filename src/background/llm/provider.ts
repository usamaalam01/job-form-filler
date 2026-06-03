import type { LLMRequest, LLMResponse, LLMError } from '@shared/types'

export interface LLMProvider {
  id: string
  name: string
  complete(req: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse>
}

export class LLMProviderError extends Error {
  constructor(public readonly llmError: LLMError) {
    super(llmError.message)
    this.name = 'LLMProviderError'
  }
}

export class FallbackExhaustedError extends Error {
  constructor(public readonly errors: LLMError[]) {
    super('All LLM providers failed.')
    this.name = 'FallbackExhaustedError'
  }
}

// ─── HTTP error → LLMError classifier ────────────────────────────────────────

export function classifyHttpError(status: number, body: string): LLMError {
  if (status === 401 || status === 403) {
    return { type: 'auth', status, message: `Auth error ${status}: ${body.slice(0, 200)}`, retryable: false }
  }
  if (status === 429) {
    return { type: 'rate-limit', status, message: 'Rate limited.', retryable: true }
  }
  if (status >= 500) {
    return { type: 'server', status, message: `Server error ${status}.`, retryable: true }
  }
  return { type: 'unknown', status, message: `HTTP ${status}: ${body.slice(0, 200)}`, retryable: true }
}

// ─── Fetch with AbortController timeout ──────────────────────────────────────

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new LLMProviderError({ type: 'timeout', message: `Request timed out after ${timeoutMs}ms.`, retryable: true })
    }
    throw new LLMProviderError({ type: 'network', message: (err as Error).message, retryable: true })
  } finally {
    clearTimeout(timer)
  }
}
