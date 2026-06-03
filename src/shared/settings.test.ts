import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SettingsService, SETTINGS_DEFAULTS } from './settings'
import type { AppSettings } from './types'

describe('SettingsService', () => {
  let svc: SettingsService

  beforeEach(() => {
    svc = new SettingsService()
    vi.clearAllMocks()
    // Reset chrome.storage mock state between tests
    chrome.storage.local.clear()
  })

  // ── parse / defaults ──────────────────────────────────────────────────────

  it('parse returns defaults when given an empty object', () => {
    const s = svc.parse({})
    expect(s.version).toBe(1)
    expect(s.aiDrafting).toBe(true)
    expect(s.confidenceThreshold).toBe('high')
    expect(s.autoAddRepeatableBlocks).toBe(false)
    expect(s.dedupeWindow).toBe(365)
    expect(s.llmTimeoutMs).toBe(30_000)
    expect(s.maxFieldBatchSize).toBe(30)
    expect(s.fallbackChain).toEqual([])
    expect(s.defaultProfile).toBeNull()
    expect(s.keyPersistenceMode).toBe('persisted')
    expect(s.providers.length).toBeGreaterThan(0)
  })

  it('parse overrides defaults with stored values', () => {
    const s = svc.parse({ aiDrafting: false, dedupeWindow: 90 })
    expect(s.aiDrafting).toBe(false)
    expect(s.dedupeWindow).toBe(90)
    expect(s.confidenceThreshold).toBe('high') // still default
  })

  it('parse merges stored providers with defaults, preserving stored entries', () => {
    const stored = [{ id: 'openai', name: 'OpenAI', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' }]
    const s = svc.parse({ providers: stored })
    const openai = s.providers.find(p => p.id === 'openai')
    expect(openai?.model).toBe('gpt-4o') // stored value preserved
    // Default providers not in stored should still be present
    expect(s.providers.find(p => p.id === 'gemini')).toBeDefined()
    expect(s.providers.find(p => p.id === 'anthropic')).toBeDefined()
  })

  it('serialise + parse roundtrip is stable', () => {
    const original = svc.parse({ aiDrafting: false, fallbackChain: ['openai', 'gemini'] })
    const raw = svc.serialise(original)
    const restored = svc.parse(raw)
    expect(restored.aiDrafting).toBe(false)
    expect(restored.fallbackChain).toEqual(['openai', 'gemini'])
  })

  // ── API key management ────────────────────────────────────────────────────

  it('getApiKey returns null when no key is stored', async () => {
    const key = await svc.getApiKey('openai')
    expect(key).toBeNull()
  })

  it('setApiKey (persisted) + getApiKey roundtrip', async () => {
    const settings = svc.parse({})
    await svc.setApiKey('openai', 'sk-test-123', settings)
    const key = await svc.getApiKey('openai')
    expect(key).toBe('sk-test-123')
  })

  it('setApiKey (session) stores in memory, not chrome.storage', async () => {
    const settings: AppSettings = { ...SETTINGS_DEFAULTS, keyPersistenceMode: 'session' }
    await svc.setApiKey('openai', 'sk-session-key', settings)
    // chrome.storage.local should NOT have been written
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
    // But getApiKey should still return it
    const key = await svc.getApiKey('openai')
    expect(key).toBe('sk-session-key')
  })

  it('clearApiKey removes both persisted and session keys', async () => {
    const settings = svc.parse({})
    await svc.setApiKey('openai', 'sk-test', settings)
    await svc.clearApiKey('openai')
    const key = await svc.getApiKey('openai')
    expect(key).toBeNull()
  })

  it('clearAllApiKeys removes all provider keys', async () => {
    const settings = svc.parse({})
    await svc.setApiKey('openai', 'sk-a', settings)
    await svc.setApiKey('gemini', 'AIza-b', settings)
    await svc.clearAllApiKeys(['openai', 'gemini', 'anthropic', 'custom'])
    expect(await svc.getApiKey('openai')).toBeNull()
    expect(await svc.getApiKey('gemini')).toBeNull()
  })

  it('session key takes priority over persisted key', async () => {
    // Set a persisted key first
    const persistedSettings = svc.parse({})
    await svc.setApiKey('openai', 'persisted-key', persistedSettings)
    // Now set a session key
    const sessionSettings: AppSettings = { ...SETTINGS_DEFAULTS, keyPersistenceMode: 'session' }
    await svc.setApiKey('openai', 'session-key', sessionSettings)
    // Session key wins
    const key = await svc.getApiKey('openai')
    expect(key).toBe('session-key')
  })

  it('clearSessionKeys removes only in-memory keys', async () => {
    const sessionSettings: AppSettings = { ...SETTINGS_DEFAULTS, keyPersistenceMode: 'session' }
    await svc.setApiKey('openai', 'session-key', sessionSettings)
    svc.clearSessionKeys()
    // Falls back to persisted (which is null)
    const key = await svc.getApiKey('openai')
    expect(key).toBeNull()
  })
})
