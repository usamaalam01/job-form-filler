import type { ApplicationRecord, HistoryFile } from './types'
import type { FileStore } from '../panel/filestore'

// ─── URL normalisation ────────────────────────────────────────────────────────

const SIGNIFICANT_PARAMS = new Set([
  'jobid', 'job_id', 'requisitionid', 'req_id', 'jobref',
  'positionid', 'position_id', 'vacancyid',
])

export function normalizeUrl(url: string, significantParams = SIGNIFICANT_PARAMS): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    let path = (u.hostname + u.pathname)
      .replace(/^www\./, '')
      .replace(/\/$/, '')
      .toLowerCase()

    // Preserve only significant query params
    const kept: string[] = []
    for (const [k, v] of u.searchParams.entries()) {
      if (significantParams.has(k.toLowerCase())) kept.push(`${k}=${v}`)
    }
    if (kept.length) path += `?${kept.sort().join('&')}`
    return path
  } catch {
    return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  }
}

// ─── HistoryService ───────────────────────────────────────────────────────────

export class HistoryService {
  constructor(private readonly store: FileStore) {}

  async load(): Promise<HistoryFile> {
    return this.store.readHistory()
  }

  async add(record: Omit<ApplicationRecord, 'id'>): Promise<ApplicationRecord> {
    const history = await this.load()
    const full: ApplicationRecord = {
      id: crypto.randomUUID(),
      ...record,
    }
    history.applications.push(full)
    await this.store.writeHistory(history)
    return full
  }

  async updateStatus(id: string, status: ApplicationRecord['status']): Promise<void> {
    const history = await this.load()
    const rec = history.applications.find(a => a.id === id)
    if (rec) {
      rec.status = status
      await this.store.writeHistory(history)
    }
  }

  async checkDuplicate(
    url: string,
    company: string | null,
    role: string | null,
    dedupeWindowDays = 365,
  ): Promise<ApplicationRecord | null> {
    const history = await this.load()
    const normalized = normalizeUrl(url)
    const cutoff = Date.now() - dedupeWindowDays * 24 * 60 * 60 * 1000

    for (const rec of history.applications) {
      // Exact URL match — always a duplicate regardless of age
      if (rec.url_normalized === normalized) return rec

      // Company + role match within the window
      if (
        company && role &&
        rec.company && rec.role &&
        rec.company.toLowerCase() === company.toLowerCase() &&
        rec.role.toLowerCase() === role.toLowerCase() &&
        new Date(rec.filled_at).getTime() >= cutoff
      ) {
        return rec
      }
    }
    return null
  }

  async list(): Promise<ApplicationRecord[]> {
    const history = await this.load()
    return [...history.applications].sort(
      (a, b) => new Date(b.filled_at).getTime() - new Date(a.filled_at).getTime()
    )
  }

  async search(query: string): Promise<ApplicationRecord[]> {
    const records = await this.list()
    const q = query.toLowerCase()
    return records.filter(r =>
      r.company?.toLowerCase().includes(q) ||
      r.role?.toLowerCase().includes(q) ||
      r.url.toLowerCase().includes(q)
    )
  }
}
