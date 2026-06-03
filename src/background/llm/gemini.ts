import type { LLMRequest, LLMResponse } from '@shared/types'
import type { LLMProvider } from './provider'
import { LLMProviderError, classifyHttpError, fetchWithTimeout } from './provider'

export class GeminiAdapter implements LLMProvider {
  constructor(
    public readonly id: string,
    public readonly name: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async complete(req: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse> {
    const model = this.model || 'gemini-1.5-flash'
    const base = this.baseUrl.replace(/\/$/, '')
    const url = `${base}/models/${model}:generateContent?key=${apiKey}`

    const body: Record<string, unknown> = {
      system_instruction: { parts: [{ text: req.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.1,
        maxOutputTokens: req.maxTokens ?? 1024,
        ...(req.responseSchema ? { responseMimeType: 'application/json' } : {}),
      },
    }

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs)

    const text = await res.text()
    if (!res.ok) throw new LLMProviderError(classifyHttpError(res.status, text))

    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(text) } catch {
      throw new LLMProviderError({ type: 'invalid-output', message: 'Non-JSON response from Gemini.', retryable: true })
    }

    // Check for safety block
    const candidate = (parsed['candidates'] as Array<Record<string, unknown>>)?.[0]
    if (candidate?.['finishReason'] === 'SAFETY') {
      throw new LLMProviderError({ type: 'safety', message: 'Gemini blocked the request for safety reasons.', retryable: true })
    }

    const content = (candidate?.['content'] as { parts?: Array<{ text: string }> } | undefined)
      ?.parts?.[0]?.text ?? ''
    const usage = parsed['usageMetadata'] as { totalTokenCount?: number } | undefined
    return { content, tokensUsed: usage?.totalTokenCount, providerId: this.id }
  }
}
