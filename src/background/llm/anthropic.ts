import type { LLMRequest, LLMResponse } from '@shared/types'
import type { LLMProvider } from './provider'
import { LLMProviderError, classifyHttpError, fetchWithTimeout } from './provider'

export class AnthropicAdapter implements LLMProvider {
  constructor(
    public readonly id: string,
    public readonly name: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async complete(req: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/messages`

    // Anthropic uses system prompt + user message; structured output via instruction
    const systemPrompt = req.responseSchema
      ? req.systemPrompt + '\n\nYou MUST respond with valid JSON only. Do not include any text outside the JSON object.'
      : req.systemPrompt

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
    }

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, timeoutMs)

    const text = await res.text()
    if (!res.ok) {
      // Anthropic safety refusals come as 400 with stop_reason = "max_tokens" or overloaded_error
      if (res.status === 400 && text.includes('stop_reason')) {
        throw new LLMProviderError({ type: 'safety', message: 'Anthropic refused the request.', retryable: true })
      }
      throw new LLMProviderError(classifyHttpError(res.status, text))
    }

    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(text) } catch {
      throw new LLMProviderError({ type: 'invalid-output', message: 'Non-JSON response from Anthropic.', retryable: true })
    }

    const content = (parsed['content'] as Array<{ type: string; text: string }>)
      ?.find(b => b.type === 'text')?.text ?? ''
    const usage = parsed['usage'] as { input_tokens?: number; output_tokens?: number } | undefined
    const tokensUsed = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
    return { content, tokensUsed: tokensUsed || undefined, providerId: this.id }
  }
}
