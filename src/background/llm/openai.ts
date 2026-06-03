import type { LLMRequest, LLMResponse } from '@shared/types'
import type { LLMProvider } from './provider'
import { LLMProviderError, classifyHttpError, fetchWithTimeout } from './provider'

export class OpenAIAdapter implements LLMProvider {
  constructor(
    public readonly id: string,
    public readonly name: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async complete(req: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`

    const body: Record<string, unknown> = {
      model: this.model,
      temperature: req.temperature ?? 0.1,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user',   content: req.userPrompt },
      ],
    }
    if (req.maxTokens) body['max_tokens'] = req.maxTokens
    if (req.responseSchema) body['response_format'] = { type: 'json_object' }

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, timeoutMs)

    const text = await res.text()
    if (!res.ok) throw new LLMProviderError(classifyHttpError(res.status, text))

    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(text) } catch {
      throw new LLMProviderError({ type: 'invalid-output', message: 'Non-JSON response from OpenAI.', retryable: true })
    }

    const content = (parsed['choices'] as Array<{ message: { content: string } }>)?.[0]?.message?.content ?? ''
    const tokensUsed = (parsed['usage'] as { total_tokens?: number } | undefined)?.total_tokens
    return { content, tokensUsed, providerId: this.id }
  }
}
