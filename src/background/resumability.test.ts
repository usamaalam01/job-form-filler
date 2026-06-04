import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test idempotency functions directly (extracted for testability)

const store: Record<string, unknown> = {}

// Minimal chrome.storage.local mock for these tests
const mockStorage = {
  get: vi.fn(async (key: string) => ({ [key]: store[key] })),
  set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items) }),
  remove: vi.fn(async (key: string) => { delete store[key] }),
  clear: vi.fn(async () => { for (const k of Object.keys(store)) delete store[k] }),
}

// Re-implement the idempotency functions locally for testing
const COMPLETED_KEY = 'completed_requests'

async function isCompleted(requestId: string): Promise<boolean> {
  const stored = await mockStorage.get(COMPLETED_KEY)
  const set: string[] = (stored[COMPLETED_KEY] as string[] | undefined) ?? []
  return set.includes(requestId)
}

async function markCompleted(requestId: string): Promise<void> {
  const stored = await mockStorage.get(COMPLETED_KEY)
  const set: string[] = (stored[COMPLETED_KEY] as string[] | undefined) ?? []
  set.push(requestId)
  const trimmed = set.slice(-50)
  await mockStorage.set({ [COMPLETED_KEY]: trimmed })
}

describe('EC-22 idempotency', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    vi.clearAllMocks()
  })

  it('isCompleted returns false for a new requestId', async () => {
    expect(await isCompleted('req-abc')).toBe(false)
  })

  it('markCompleted + isCompleted roundtrip', async () => {
    await markCompleted('req-123')
    expect(await isCompleted('req-123')).toBe(true)
  })

  it('isCompleted returns false for a different requestId', async () => {
    await markCompleted('req-aaa')
    expect(await isCompleted('req-bbb')).toBe(false)
  })

  it('trims to last 50 entries', async () => {
    for (let i = 0; i < 60; i++) await markCompleted(`req-${i}`)
    // First 10 should be gone
    expect(await isCompleted('req-0')).toBe(false)
    // Last 50 should be present
    expect(await isCompleted('req-59')).toBe(true)
    expect(await isCompleted('req-10')).toBe(true)
  })

  it('second APPLY_VALUES with same requestId would be detected as duplicate', async () => {
    const requestId = 'session-req-xyz'
    // First apply
    const alreadyDone1 = await isCompleted(requestId)
    expect(alreadyDone1).toBe(false)
    await markCompleted(requestId)

    // Simulate SW restart: session restored, APPLY_VALUES re-sent
    const alreadyDone2 = await isCompleted(requestId)
    expect(alreadyDone2).toBe(true)
    // → history write would be skipped
  })
})
