import type { Message, MessageType, MessageResponse, MessageEnvelope, MessageError } from './types'

// ─── Send helpers ─────────────────────────────────────────────────────────────

/**
 * Send a message to the background service worker and await a typed response.
 * All responses are wrapped in { ok, data } / { ok, error } envelopes.
 */
export async function sendToBackground<TPayload, TData>(
  msg: Message<TPayload>,
): Promise<TData> {
  const response = await chrome.runtime.sendMessage<Message<TPayload>, MessageResponse<TData>>(msg)
  return unwrap<TData>(response)
}

/**
 * Send a message to the content script in a specific tab.
 */
export async function sendToContent<TPayload, TData>(
  tabId: number,
  msg: Message<TPayload>,
): Promise<TData> {
  const response = await chrome.tabs.sendMessage<Message<TPayload>, MessageResponse<TData>>(tabId, msg)
  return unwrap<TData>(response)
}

// ─── Listener registration ────────────────────────────────────────────────────

type SyncHandler<TPayload, TData> = (
  payload: TPayload,
  sender: chrome.runtime.MessageSender,
) => TData | Promise<TData>

/**
 * Register a typed handler for a specific message type.
 * Returns an unsubscribe function.
 * The handler's return value is automatically wrapped in the success envelope.
 * Thrown errors are caught and wrapped in the error envelope.
 */
export function onMessage<TPayload, TData>(
  type: MessageType,
  handler: SyncHandler<TPayload, TData>,
): () => void {
  const listener = (
    message: Message<TPayload>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r: MessageResponse<TData>) => void,
  ): boolean => {
    if (message.type !== type) return false

    Promise.resolve()
      .then(() => handler(message.payload, sender))
      .then((data): MessageEnvelope<TData> => ({
        ok: true,
        data,
        requestId: message.requestId,
      }))
      .catch((err: unknown): MessageError => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        requestId: message.requestId,
      }))
      .then(sendResponse)

    // Return true to keep the message channel open for the async response
    return true
  }

  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function unwrap<T>(response: MessageResponse<T>): T {
  if (!response) {
    throw new Error('No response received from message handler.')
  }
  if (!response.ok) {
    throw new Error((response as MessageError).error)
  }
  return (response as MessageEnvelope<T>).data
}
