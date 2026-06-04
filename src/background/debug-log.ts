export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: string
  level: LogLevel
  context: string
  message: string
  data?: unknown
}

const MAX_ENTRIES = 500

// ─── Redaction ────────────────────────────────────────────────────────────────

const API_KEY_PATTERNS = [
  /sk-[A-Za-z0-9\-_]{10,}/g,        // OpenAI
  /sk-ant-[A-Za-z0-9\-_]{10,}/g,    // Anthropic
  /AIza[A-Za-z0-9\-_]{10,}/g,       // Google / Gemini
  /Bearer\s+[A-Za-z0-9\-_\.]{10,}/g, // Generic Bearer tokens
]

function redact(text: string): string {
  let out = text
  for (const pattern of API_KEY_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]')
  }
  return out
}

function sanitizeData(data: unknown): unknown {
  if (data === undefined || data === null) return data
  if (typeof data === 'string') return redact(data.slice(0, 500))
  if (typeof data === 'number' || typeof data === 'boolean') return data
  if (Array.isArray(data)) return data.slice(0, 10).map(sanitizeData)
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      // Redact key-named fields outright
      if (/key|token|secret|password|auth/i.test(k)) {
        out[k] = '[REDACTED]'
      } else if (typeof v === 'string') {
        out[k] = redact(v.slice(0, 200))
      } else {
        out[k] = sanitizeData(v)
      }
    }
    return out
  }
  return String(data).slice(0, 200)
}

// ─── DebugLog ─────────────────────────────────────────────────────────────────

class DebugLog {
  private entries: LogEntry[] = []

  log(level: LogLevel, context: string, message: string, data?: unknown): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      context,
      message: redact(message),
      data: data !== undefined ? sanitizeData(data) : undefined,
    }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()

    // Also mirror to console for DevTools visibility
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    consoleFn(`[JFF:${context}] ${message}`, data ?? '')
  }

  info(context: string, message: string, data?: unknown): void {
    this.log('info', context, message, data)
  }

  warn(context: string, message: string, data?: unknown): void {
    this.log('warn', context, message, data)
  }

  error(context: string, message: string, data?: unknown): void {
    this.log('error', context, message, data)
  }

  getEntries(): LogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  /** Triggers a JSON blob download in the side panel context. */
  download(): void {
    const blob = new Blob([JSON.stringify(this.entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jff-debug-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  get size(): number {
    return this.entries.length
  }
}

export const debugLog = new DebugLog()
