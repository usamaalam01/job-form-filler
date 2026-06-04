import { describe, it, expect, beforeEach } from 'vitest'
import { debugLog } from './debug-log'

describe('DebugLog', () => {
  beforeEach(() => debugLog.clear())

  it('stores log entries', () => {
    debugLog.info('test', 'hello world')
    expect(debugLog.getEntries()).toHaveLength(1)
    expect(debugLog.getEntries()[0].message).toBe('hello world')
    expect(debugLog.getEntries()[0].level).toBe('info')
    expect(debugLog.getEntries()[0].context).toBe('test')
  })

  it('truncates to 500 entries (ring buffer)', () => {
    for (let i = 0; i < 510; i++) debugLog.info('ctx', `msg ${i}`)
    expect(debugLog.size).toBe(500)
    // Oldest entry should be gone; newest present
    const entries = debugLog.getEntries()
    expect(entries[0].message).toBe('msg 10')
    expect(entries[499].message).toBe('msg 509')
  })

  it('redacts OpenAI API keys from messages', () => {
    debugLog.error('llm', 'Auth failed for key sk-abcdefghijklmnopqrstuvwxyz123456')
    expect(debugLog.getEntries()[0].message).toContain('[REDACTED]')
    expect(debugLog.getEntries()[0].message).not.toContain('sk-abcdefghijklm')
  })

  it('redacts Anthropic API keys', () => {
    debugLog.error('llm', 'Request with sk-ant-api03-abcdefghijklmnop failed')
    expect(debugLog.getEntries()[0].message).toContain('[REDACTED]')
  })

  it('redacts Google API keys', () => {
    debugLog.error('llm', 'Key AIzaSyAbcdefghijklmnopqrstuvwx failed')
    expect(debugLog.getEntries()[0].message).toContain('[REDACTED]')
  })

  it('redacts apiKey fields in data objects', () => {
    debugLog.info('settings', 'Provider config', { apiKey: 'sk-secret-value', model: 'gpt-4o' })
    const entry = debugLog.getEntries()[0]
    expect((entry.data as Record<string, unknown>)['apiKey']).toBe('[REDACTED]')
    expect((entry.data as Record<string, unknown>)['model']).toBe('gpt-4o')
  })

  it('truncates long string data values', () => {
    const long = 'x'.repeat(300)
    debugLog.info('ctx', 'test', { field: long })
    const data = debugLog.getEntries()[0].data as Record<string, unknown>
    expect((data['field'] as string).length).toBeLessThanOrEqual(200)
  })

  it('clear() empties the log', () => {
    debugLog.info('ctx', 'entry 1')
    debugLog.clear()
    expect(debugLog.size).toBe(0)
  })

  it('getEntries() returns a copy, not the internal array', () => {
    debugLog.info('ctx', 'a')
    const entries = debugLog.getEntries()
    entries.push({ ts: '', level: 'info', context: 'x', message: 'injected' })
    expect(debugLog.size).toBe(1) // internal unaffected
  })

  it('supports warn and error log levels', () => {
    debugLog.warn('ctx', 'a warning')
    debugLog.error('ctx', 'an error')
    const entries = debugLog.getEntries()
    expect(entries[0].level).toBe('warn')
    expect(entries[1].level).toBe('error')
  })

  it('sanitizes nested objects', () => {
    debugLog.info('ctx', 'nested', { outer: { token: 'secret-token-abc123', safe: 'ok' } })
    const data = debugLog.getEntries()[0].data as Record<string, Record<string, unknown>>
    expect(data['outer']['token']).toBe('[REDACTED]')
    expect(data['outer']['safe']).toBe('ok')
  })

  it('getEntries() produces valid JSON when serialised', () => {
    debugLog.info('ctx', 'test', { a: 1 })
    const json = JSON.stringify(debugLog.getEntries())
    const parsed = JSON.parse(json)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].message).toBe('test')
  })
})
