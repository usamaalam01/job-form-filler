import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendToBackground, sendToContent, onMessage } from './messaging'
import type { Message, MessageResponse } from './types'

describe('messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── sendToBackground ──────────────────────────────────────────────────────

  it('sendToBackground resolves with unwrapped data on success', async () => {
    const successEnvelope: MessageResponse<string> = { ok: true, data: 'hello' }
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(successEnvelope)

    const result = await sendToBackground<void, string>({ type: 'DETECT_FIELDS', payload: undefined })
    expect(result).toBe('hello')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'DETECT_FIELDS', payload: undefined })
  })

  it('sendToBackground throws on error envelope', async () => {
    const errorEnvelope: MessageResponse<never> = { ok: false, error: 'Something went wrong' }
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(errorEnvelope)

    await expect(
      sendToBackground<void, string>({ type: 'DETECT_FIELDS', payload: undefined })
    ).rejects.toThrow('Something went wrong')
  })

  it('sendToBackground throws when response is null/undefined', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(undefined)

    await expect(
      sendToBackground<void, string>({ type: 'MAP_FIELDS', payload: undefined })
    ).rejects.toThrow('No response received')
  })

  // ── sendToContent ─────────────────────────────────────────────────────────

  it('sendToContent sends to the specified tab and unwraps', async () => {
    const successEnvelope: MessageResponse<number> = { ok: true, data: 42 }
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValueOnce(successEnvelope)

    const result = await sendToContent<void, number>(123, { type: 'APPLY_VALUES', payload: undefined })
    expect(result).toBe(42)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, { type: 'APPLY_VALUES', payload: undefined })
  })

  it('sendToContent throws on error envelope', async () => {
    const errorEnvelope: MessageResponse<never> = { ok: false, error: 'Tab error' }
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValueOnce(errorEnvelope)

    await expect(
      sendToContent<void, number>(99, { type: 'APPLY_VALUES', payload: undefined })
    ).rejects.toThrow('Tab error')
  })

  // ── onMessage ─────────────────────────────────────────────────────────────

  it('onMessage registers a listener for the correct message type', () => {
    const handler = vi.fn().mockResolvedValue('result')
    onMessage('DETECT_FIELDS', handler)

    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce()
  })

  it('onMessage returns an unsubscribe function', () => {
    const handler = vi.fn()
    const unsubscribe = onMessage('MAP_FIELDS', handler)
    unsubscribe()
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledOnce()
  })

  it('onMessage handler wraps success response in ok envelope', async () => {
    let capturedListener: ((msg: Message<unknown>, sender: chrome.runtime.MessageSender, sendResponse: (r: MessageResponse<unknown>) => void) => boolean) | null = null

    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation((fn) => {
      capturedListener = fn as typeof capturedListener
    })

    onMessage('HISTORY_ADD', async (_payload) => ({ saved: true }))

    expect(capturedListener).not.toBeNull()

    const sendResponse = vi.fn()
    const msg: Message<string> = { type: 'HISTORY_ADD', payload: 'data', requestId: 'req-1' }
    const keepOpen = capturedListener!(msg, {} as chrome.runtime.MessageSender, sendResponse)
    expect(keepOpen).toBe(true)

    // Wait for async handler
    await new Promise(r => setTimeout(r, 10))
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { saved: true }, requestId: 'req-1' })
  })

  it('onMessage handler wraps thrown error in error envelope', async () => {
    let capturedListener: ((msg: Message<unknown>, sender: chrome.runtime.MessageSender, sendResponse: (r: MessageResponse<unknown>) => void) => boolean) | null = null

    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation((fn) => {
      capturedListener = fn as typeof capturedListener
    })

    onMessage('DUPLICATE_CHECK', () => { throw new Error('duplicate!') })

    const sendResponse = vi.fn()
    capturedListener!(
      { type: 'DUPLICATE_CHECK', payload: null, requestId: 'req-2' },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    )

    await new Promise(r => setTimeout(r, 10))
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'duplicate!', requestId: 'req-2' })
  })

  it('onMessage ignores messages with a different type', () => {
    let capturedListener: ((msg: Message<unknown>, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => boolean) | null = null
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation((fn) => {
      capturedListener = fn as typeof capturedListener
    })

    const handler = vi.fn()
    onMessage('MAP_FIELDS', handler)

    const sendResponse = vi.fn()
    const result = capturedListener!(
      { type: 'DETECT_FIELDS', payload: null },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    )

    expect(result).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })
})
