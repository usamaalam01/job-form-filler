import type { LLMRequest, LLMResponse, LLMError, ProviderConfig } from '@shared/types'
import type { SettingsService } from '@shared/settings'
import type { LLMProvider } from './provider'
import { LLMProviderError, FallbackExhaustedError } from './provider'
import { OpenAIAdapter } from './openai'
import { AnthropicAdapter } from './anthropic'
import { GeminiAdapter } from './gemini'
import { CustomAdapter } from './custom'

// ─── Provider factory ─────────────────────────────────────────────────────────

export function makeProvider(cfg: ProviderConfig): LLMProvider {
  switch (cfg.id) {
    case 'openai':    return new OpenAIAdapter(cfg.id, cfg.name, cfg.model, cfg.baseUrl)
    case 'anthropic': return new AnthropicAdapter(cfg.id, cfg.name, cfg.model, cfg.baseUrl)
    case 'gemini':    return new GeminiAdapter(cfg.id, cfg.name, cfg.model, cfg.baseUrl)
    default:          return new CustomAdapter(cfg.id, cfg.name, cfg.model, cfg.baseUrl)
  }
}

// ─── In-memory debug log (last 500 entries) ───────────────────────────────────

interface LogEntry { ts: string; providerId: string; ok: boolean; error?: string; tokensUsed?: number }
const debugLog: LogEntry[] = []
export function getDebugLog(): LogEntry[] { return [...debugLog] }
function appendLog(e: LogEntry) {
  debugLog.push(e)
  if (debugLog.length > 500) debugLog.shift()
}

// ─── Provider health cache ────────────────────────────────────────────────────

const unhealthyProviders = new Set<string>()
export function markUnhealthy(providerId: string) { unhealthyProviders.add(providerId) }
export function clearHealth(providerId: string) { unhealthyProviders.delete(providerId) }

// ─── FallbackChain ────────────────────────────────────────────────────────────

export class FallbackChain {
  constructor(
    private readonly chain: string[],
    private readonly settings: SettingsService,
    private readonly appSettings: { providers: ProviderConfig[]; llmTimeoutMs: number },
  ) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const errors: LLMError[] = []

    for (const providerId of this.chain) {
      const cfg = this.appSettings.providers.find(p => p.id === providerId)
      if (!cfg || !cfg.model) continue // skip unconfigured

      const apiKey = await this.settings.getApiKey(providerId)
      if (!apiKey) continue // skip providers with no key

      const provider = makeProvider(cfg)

      try {
        const response = await provider.complete(req, apiKey, this.appSettings.llmTimeoutMs)
        appendLog({ ts: new Date().toISOString(), providerId, ok: true, tokensUsed: response.tokensUsed })
        clearHealth(providerId)
        return response
      } catch (err) {
        const llmErr = err instanceof LLMProviderError
          ? err.llmError
          : { type: 'unknown' as const, message: String(err), retryable: true }

        appendLog({ ts: new Date().toISOString(), providerId, ok: false, error: llmErr.message })

        // Mark auth failures in the health cache so the UI can surface them
        if (llmErr.type === 'auth') markUnhealthy(providerId)

        errors.push(llmErr)
        // Continue to next provider regardless of error type
      }
    }

    throw new FallbackExhaustedError(errors)
  }

  /** Sends a minimal 1-token test request. Returns latencyMs on success. */
  async testProvider(providerId: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const cfg = this.appSettings.providers.find(p => p.id === providerId)
    if (!cfg) return { ok: false, error: 'Provider not configured.' }
    const apiKey = await this.settings.getApiKey(providerId)
    if (!apiKey) return { ok: false, error: 'No API key set.' }
    const provider = makeProvider(cfg)
    const start = Date.now()
    try {
      await provider.complete(
        { systemPrompt: 'Reply with the single word: ok', userPrompt: 'ok', maxTokens: 5 },
        apiKey,
        this.appSettings.llmTimeoutMs,
      )
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, error: err instanceof LLMProviderError ? err.llmError.message : String(err) }
    }
  }
}
