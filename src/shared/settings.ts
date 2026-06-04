import type { AppSettings, ProviderConfig } from './types'

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'openai',    name: 'OpenAI',    model: '', baseUrl: 'https://api.openai.com/v1' },
  { id: 'groq',      name: 'Groq',      model: '', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'deepseek',  name: 'DeepSeek',  model: '', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'gemini',    name: 'Gemini',    model: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'anthropic', name: 'Anthropic', model: '', baseUrl: 'https://api.anthropic.com' },
  { id: 'custom',    name: 'Custom',    model: '', baseUrl: '' },
]

export const SETTINGS_DEFAULTS: AppSettings = {
  version: 1,
  defaultProfile: null,
  aiDrafting: true,
  confidenceThreshold: 'high',
  autoAddRepeatableBlocks: false,
  dedupeWindow: 365,
  llmTimeoutMs: 30_000,
  maxFieldBatchSize: 30,
  fallbackChain: [],
  providers: DEFAULT_PROVIDERS,
  keyPersistenceMode: 'persisted',
}

// ─── chrome.storage.local key helpers ────────────────────────────────────────

function apiKeyStorageKey(providerId: string): string {
  return `apikey_${providerId}`
}

// ─── SettingsService ─────────────────────────────────────────────────────────

/**
 * Non-secret settings are read/written via the FileStore (caller provides the
 * raw JSON string from settings.json).  Secret API keys live exclusively in
 * chrome.storage.local — never on disk.
 *
 * Usage:
 *   const svc = new SettingsService()
 *   const settings = svc.parse(await fileStore.readSettings())
 *   await svc.setApiKey('openai', 'sk-...')
 */
export class SettingsService {
  private sessionKeys: Map<string, string> = new Map()

  /**
   * Merge a raw settings object (from settings.json) with defaults.
   * Missing fields fall back to SETTINGS_DEFAULTS so callers always get a
   * fully-populated AppSettings.
   */
  parse(raw: Record<string, unknown>): AppSettings {
    return {
      ...SETTINGS_DEFAULTS,
      ...raw,
      // Deep-merge providers: keep stored entries, fill gaps with defaults
      providers: this.mergeProviders(raw['providers'] as ProviderConfig[] | undefined),
    }
  }

  /** Serialise AppSettings to a plain object suitable for JSON storage. */
  serialise(settings: AppSettings): Record<string, unknown> {
    return settings as unknown as Record<string, unknown>
  }

  // ── API key management ────────────────────────────────────────────────────

  async getApiKey(providerId: string): Promise<string | null> {
    // Session-only keys take priority
    if (this.sessionKeys.has(providerId)) {
      return this.sessionKeys.get(providerId)!
    }
    const key = apiKeyStorageKey(providerId)
    const result = await chrome.storage.local.get(key)
    return (result[key] as string | undefined) ?? null
  }

  async setApiKey(providerId: string, apiKey: string, settings: AppSettings): Promise<void> {
    if (settings.keyPersistenceMode === 'session') {
      this.sessionKeys.set(providerId, apiKey)
      return
    }
    await chrome.storage.local.set({ [apiKeyStorageKey(providerId)]: apiKey })
  }

  async clearApiKey(providerId: string): Promise<void> {
    this.sessionKeys.delete(providerId)
    await chrome.storage.local.remove(apiKeyStorageKey(providerId))
  }

  async clearAllApiKeys(providerIds: string[]): Promise<void> {
    this.sessionKeys.clear()
    await chrome.storage.local.remove(providerIds.map(apiKeyStorageKey))
  }

  /** Called on extension unload / when keyPersistenceMode = 'session'. */
  clearSessionKeys(): void {
    this.sessionKeys.clear()
  }

  /**
   * Persists the LLM-relevant parts of settings (fallbackChain + providers)
   * to chrome.storage.local so the background SW can read them without needing
   * the FileStore folder handle. Call this whenever settings are saved to disk.
   */
  async cacheLLMSettings(settings: AppSettings): Promise<void> {
    await chrome.storage.local.set({
      llm_fallbackChain: settings.fallbackChain,
      llm_providers: settings.providers,
      llm_timeoutMs: settings.llmTimeoutMs,
    })
  }

  /**
   * Reads LLM settings from chrome.storage.local cache.
   * Returns a partial AppSettings with only the LLM fields populated.
   * Falls back to SETTINGS_DEFAULTS if nothing is cached.
   */
  async loadCachedLLMSettings(): Promise<AppSettings> {
    const result = await chrome.storage.local.get(['llm_fallbackChain', 'llm_providers', 'llm_timeoutMs'])
    return {
      ...SETTINGS_DEFAULTS,
      fallbackChain: (result['llm_fallbackChain'] as string[] | undefined) ?? SETTINGS_DEFAULTS.fallbackChain,
      providers: this.mergeProviders(result['llm_providers'] as ProviderConfig[] | undefined),
      llmTimeoutMs: (result['llm_timeoutMs'] as number | undefined) ?? SETTINGS_DEFAULTS.llmTimeoutMs,
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private mergeProviders(stored: ProviderConfig[] | undefined): ProviderConfig[] {
    if (!stored || !Array.isArray(stored)) return DEFAULT_PROVIDERS
    // Keep stored providers; add any default provider not present
    const ids = new Set(stored.map(p => p.id))
    const extras = DEFAULT_PROVIDERS.filter(p => !ids.has(p.id))
    return [...stored, ...extras]
  }
}

// Singleton
export const settingsService = new SettingsService()
