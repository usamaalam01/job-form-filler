import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAIAdapter } from './openai'
import { AnthropicAdapter } from './anthropic'
import { GeminiAdapter } from './gemini'
import { FallbackChain } from './fallback'
import { FallbackExhaustedError, LLMProviderError } from './provider'
import type { LLMRequest, ProviderConfig } from '@shared/types'
import type { SettingsService } from '@shared/settings'

const REQ: LLMRequest = { systemPrompt: 'You are a helpful assistant.', userPrompt: 'Hello' }

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  })
}

// ─── OpenAI adapter ───────────────────────────────────────────────────────────

describe('OpenAIAdapter', () => {
  const adapter = new OpenAIAdapter('openai', 'OpenAI', 'gpt-4o', 'https://api.openai.com/v1')

  it('serialises request correctly', async () => {
    global.fetch = mockFetch(200, {
      choices: [{ message: { content: 'hello' } }],
      usage: { total_tokens: 10 },
    })
    const res = await adapter.complete(REQ, 'sk-test', 30000)
    expect(res.content).toBe('hello')
    expect(res.tokensUsed).toBe(10)
    expect(res.providerId).toBe('openai')

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.model).toBe('gpt-4o')
    expect(body.messages[0].role).toBe('system')
    expect(body.temperature).toBe(0.1)
  })

  it('throws auth error on 401', async () => {
    global.fetch = mockFetch(401, 'Unauthorized')
    await expect(adapter.complete(REQ, 'bad-key', 30000))
      .rejects.toMatchObject({ llmError: { type: 'auth', retryable: false } })
  })

  it('throws rate-limit error on 429', async () => {
    global.fetch = mockFetch(429, 'Too Many Requests')
    await expect(adapter.complete(REQ, 'sk-test', 30000))
      .rejects.toMatchObject({ llmError: { type: 'rate-limit', retryable: true } })
  })

  it('throws server error on 500', async () => {
    global.fetch = mockFetch(500, 'Internal Server Error')
    await expect(adapter.complete(REQ, 'sk-test', 30000))
      .rejects.toMatchObject({ llmError: { type: 'server', retryable: true } })
  })

  it('includes response_format when schema provided', async () => {
    global.fetch = mockFetch(200, { choices: [{ message: { content: '{}' } }] })
    await adapter.complete({ ...REQ, responseSchema: { type: 'object' } }, 'sk-test', 30000)
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('throws timeout error when AbortController fires', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10))
    )
    await expect(adapter.complete(REQ, 'sk-test', 1))
      .rejects.toMatchObject({ llmError: { type: 'timeout' } })
  })
})

// ─── Anthropic adapter ────────────────────────────────────────────────────────

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter('anthropic', 'Anthropic', 'claude-sonnet-4-6', 'https://api.anthropic.com')

  it('serialises request and extracts content', async () => {
    global.fetch = mockFetch(200, {
      content: [{ type: 'text', text: 'I am Claude.' }],
      usage: { input_tokens: 5, output_tokens: 5 },
    })
    const res = await adapter.complete(REQ, 'sk-ant-test', 30000)
    expect(res.content).toBe('I am Claude.')
    expect(res.tokensUsed).toBe(10)

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.system).toBe(REQ.systemPrompt)
    expect(body.messages[0].role).toBe('user')
    // Verify x-api-key header
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers['x-api-key']).toBe('sk-ant-test')
  })

  it('appends JSON instruction when responseSchema provided', async () => {
    global.fetch = mockFetch(200, { content: [{ type: 'text', text: '{}' }] })
    await adapter.complete({ ...REQ, responseSchema: { type: 'object' } }, 'key', 30000)
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.system).toContain('valid JSON only')
  })

  it('throws auth error on 403', async () => {
    global.fetch = mockFetch(403, 'Forbidden')
    await expect(adapter.complete(REQ, 'bad', 30000))
      .rejects.toMatchObject({ llmError: { type: 'auth' } })
  })
})

// ─── Gemini adapter ───────────────────────────────────────────────────────────

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter('gemini', 'Gemini', 'gemini-1.5-flash', 'https://generativelanguage.googleapis.com/v1beta')

  it('serialises to Gemini format and extracts content', async () => {
    global.fetch = mockFetch(200, {
      candidates: [{ content: { parts: [{ text: 'Gemini here.' }] }, finishReason: 'STOP' }],
      usageMetadata: { totalTokenCount: 12 },
    })
    const res = await adapter.complete(REQ, 'AIza-test', 30000)
    expect(res.content).toBe('Gemini here.')
    expect(res.tokensUsed).toBe(12)
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toContain('gemini-1.5-flash')
    expect(call[0]).toContain('key=AIza-test')

    const body = JSON.parse(call[1].body)
    expect(body.system_instruction.parts[0].text).toBe(REQ.systemPrompt)
  })

  it('throws safety error on SAFETY finishReason', async () => {
    global.fetch = mockFetch(200, {
      candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
    })
    await expect(adapter.complete(REQ, 'AIza-test', 30000))
      .rejects.toMatchObject({ llmError: { type: 'safety' } })
  })
})

// ─── FallbackChain ────────────────────────────────────────────────────────────

describe('FallbackChain', () => {
  const providers: ProviderConfig[] = [
    { id: 'openai',    name: 'OpenAI',    model: 'gpt-4o',              baseUrl: 'https://api.openai.com/v1' },
    { id: 'anthropic', name: 'Anthropic', model: 'claude-sonnet-4-6',   baseUrl: 'https://api.anthropic.com' },
  ]
  const mockSettings = {
    getApiKey: vi.fn().mockResolvedValue('test-key'),
  } as unknown as SettingsService

  function makeChain(chain: string[]) {
    return new FallbackChain(chain, mockSettings, { providers, llmTimeoutMs: 30000 })
  }

  beforeEach(() => { vi.clearAllMocks() })

  it('returns response from first provider on success', async () => {
    global.fetch = mockFetch(200, { choices: [{ message: { content: 'ok' } }] })
    const res = await makeChain(['openai', 'anthropic']).complete(REQ)
    expect(res.content).toBe('ok')
    expect(res.providerId).toBe('openai')
    expect(global.fetch).toHaveBeenCalledOnce()
  })

  it('falls through to second provider when first fails', async () => {
    let call = 0
    global.fetch = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) return Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve('rate limited') })
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ content: [{ type: 'text', text: 'fallback' }] })) })
    })
    const res = await makeChain(['openai', 'anthropic']).complete(REQ)
    expect(res.content).toBe('fallback')
    expect(res.providerId).toBe('anthropic')
  })

  it('throws FallbackExhaustedError when all providers fail', async () => {
    global.fetch = mockFetch(500, 'Server error')
    await expect(makeChain(['openai', 'anthropic']).complete(REQ))
      .rejects.toBeInstanceOf(FallbackExhaustedError)
  })

  it('skips providers with no API key', async () => {
    const noKeySettings = { getApiKey: vi.fn().mockResolvedValue(null) } as unknown as SettingsService
    const chain = new FallbackChain(['openai'], noKeySettings, { providers, llmTimeoutMs: 30000 })
    await expect(chain.complete(REQ)).rejects.toBeInstanceOf(FallbackExhaustedError)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('testProvider returns ok:true on success', async () => {
    global.fetch = mockFetch(200, { choices: [{ message: { content: 'ok' } }] })
    const chain = makeChain(['openai'])
    const result = await chain.testProvider('openai')
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('testProvider returns ok:false on auth error', async () => {
    global.fetch = mockFetch(401, 'Unauthorized')
    const chain = makeChain(['openai'])
    const result = await chain.testProvider('openai')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('LLMProviderError has llmError property', () => {
    const err = new LLMProviderError({ type: 'auth', message: 'bad key', retryable: false })
    expect(err.llmError.type).toBe('auth')
    expect(err.name).toBe('LLMProviderError')
  })
})
