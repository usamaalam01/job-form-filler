// Vitest global setup — stub chrome APIs used in unit tests.
// Extended per-test as needed.
import { vi } from 'vitest'

const chromeStorageStore: Record<string, unknown> = {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn((keys: string | string[], cb?: (r: Record<string, unknown>) => void) => {
        const result: Record<string, unknown> = {}
        const ks = typeof keys === 'string' ? [keys] : keys
        for (const k of ks) result[k] = chromeStorageStore[k]
        cb?.(result)
        return Promise.resolve(result)
      }),
      set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
        Object.assign(chromeStorageStore, items)
        cb?.()
        return Promise.resolve()
      }),
      remove: vi.fn((keys: string | string[], cb?: () => void) => {
        const ks = typeof keys === 'string' ? [keys] : keys
        for (const k of ks) delete chromeStorageStore[k]
        cb?.()
        return Promise.resolve()
      }),
      clear: vi.fn((cb?: () => void) => {
        for (const k of Object.keys(chromeStorageStore)) delete chromeStorageStore[k]
        cb?.()
        return Promise.resolve()
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
  },
  tabs: {
    sendMessage: vi.fn(),
  },
  action: {
    onClicked: { addListener: vi.fn() },
  },
  sidePanel: {
    open: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn(),
  },
} as unknown as typeof chrome
