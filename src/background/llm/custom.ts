// OpenAI-compatible adapter for self-hosted / custom endpoints
import type { LLMRequest, LLMResponse } from '@shared/types'
import type { LLMProvider } from './provider'
import { OpenAIAdapter } from './openai'

export class CustomAdapter implements LLMProvider {
  private inner: OpenAIAdapter

  constructor(
    public readonly id: string,
    public readonly name: string,
    model: string,
    baseUrl: string,
  ) {
    this.inner = new OpenAIAdapter(id, name, model, baseUrl)
  }

  complete(req: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse> {
    return this.inner.complete(req, apiKey, timeoutMs)
  }
}
