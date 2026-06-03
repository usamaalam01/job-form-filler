import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeUrl, HistoryService } from './history'
import type { FileStore } from '../panel/filestore'
import type { HistoryFile, ApplicationRecord } from './types'

// ─── Minimal FileStore stub ───────────────────────────────────────────────────

function makeStore(initial: HistoryFile = { version: 1, applications: [] }) {
  let data = structuredClone(initial)
  return {
    readHistory: vi.fn(async () => structuredClone(data)),
    writeHistory: vi.fn(async (h: HistoryFile) => { data = structuredClone(h) }),
  } as unknown as FileStore
}

function makeRecord(overrides: Partial<ApplicationRecord> = {}): Omit<ApplicationRecord, 'id'> {
  return {
    url: 'https://jobs.example.com/apply/123',
    url_normalized: normalizeUrl('https://jobs.example.com/apply/123'),
    company: 'Acme',
    role: 'Engineer',
    profile_used: 'ml-engineer',
    filled_at: new Date().toISOString(),
    status: 'filled',
    fields_filled: 10,
    fields_flagged: 2,
    ...overrides,
  }
}

// ─── normalizeUrl ─────────────────────────────────────────────────────────────

describe('normalizeUrl', () => {
  it('strips scheme', () => expect(normalizeUrl('https://example.com/job')).toBe('example.com/job'))
  it('strips www', () => expect(normalizeUrl('https://www.example.com/job')).toBe('example.com/job'))
  it('strips trailing slash', () => expect(normalizeUrl('https://example.com/job/')).toBe('example.com/job'))
  it('strips fragment', () => expect(normalizeUrl('https://example.com/job#top')).toBe('example.com/job'))
  it('strips insignificant query params', () => expect(normalizeUrl('https://example.com/job?utm_source=linkedin')).toBe('example.com/job'))
  it('preserves significant query params', () => {
    const u = normalizeUrl('https://company.wd5.myworkdayjobs.com/apply?jobId=R001&utm_source=li')
    expect(u).toContain('jobId=R001')
    expect(u).not.toContain('utm_source')
  })
  it('lowercases the result', () => expect(normalizeUrl('https://Example.COM/Job')).toBe('example.com/Job'.toLowerCase()))
  it('handles missing scheme gracefully', () => expect(normalizeUrl('example.com/job')).toBe('example.com/job'))
})

// ─── HistoryService ───────────────────────────────────────────────────────────

describe('HistoryService', () => {
  let store: FileStore
  let svc: HistoryService

  beforeEach(() => {
    store = makeStore()
    svc = new HistoryService(store)
  })

  it('add writes a record with a generated id', async () => {
    const rec = await svc.add(makeRecord())
    expect(rec.id).toBeTruthy()
    expect(store.writeHistory).toHaveBeenCalledOnce()
  })

  it('list returns records sorted newest-first', async () => {
    await svc.add(makeRecord({ filled_at: '2026-01-01T00:00:00Z', url: 'https://a.com/1', url_normalized: 'a.com/1' }))
    await svc.add(makeRecord({ filled_at: '2026-06-01T00:00:00Z', url: 'https://a.com/2', url_normalized: 'a.com/2' }))
    const list = await svc.list()
    expect(new Date(list[0].filled_at) > new Date(list[1].filled_at)).toBe(true)
  })

  it('updateStatus changes the status field', async () => {
    const rec = await svc.add(makeRecord())
    await svc.updateStatus(rec.id, 'submitted-manually')
    const list = await svc.list()
    expect(list.find(r => r.id === rec.id)?.status).toBe('submitted-manually')
  })

  it('checkDuplicate returns match on exact URL', async () => {
    await svc.add(makeRecord())
    const dup = await svc.checkDuplicate('https://jobs.example.com/apply/123', 'Other', 'Other')
    expect(dup).not.toBeNull()
  })

  it('checkDuplicate returns match on company + role within window', async () => {
    await svc.add(makeRecord({ url: 'https://a.com/1', url_normalized: 'a.com/1' }))
    const dup = await svc.checkDuplicate('https://completely-different.com', 'Acme', 'Engineer', 365)
    expect(dup).not.toBeNull()
  })

  it('checkDuplicate returns null outside the dedupeWindow', async () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    await svc.add(makeRecord({ url: 'https://a.com/1', url_normalized: 'a.com/1', filled_at: old }))
    const dup = await svc.checkDuplicate('https://completely-different.com', 'Acme', 'Engineer', 365)
    expect(dup).toBeNull()
  })

  it('checkDuplicate returns null when no match', async () => {
    await svc.add(makeRecord())
    const dup = await svc.checkDuplicate('https://other.com/job/999', 'OtherCo', 'Designer')
    expect(dup).toBeNull()
  })

  it('search filters by company name', async () => {
    await svc.add(makeRecord({ company: 'Acme Corp', url: 'https://a.com/1', url_normalized: 'a.com/1' }))
    await svc.add(makeRecord({ company: 'Beta Inc',  url: 'https://b.com/1', url_normalized: 'b.com/1' }))
    const results = await svc.search('acme')
    expect(results).toHaveLength(1)
    expect(results[0].company).toBe('Acme Corp')
  })

  it('search filters by role', async () => {
    await svc.add(makeRecord({ role: 'ML Engineer', url: 'https://a.com/1', url_normalized: 'a.com/1' }))
    await svc.add(makeRecord({ role: 'Designer',    url: 'https://b.com/1', url_normalized: 'b.com/1' }))
    const results = await svc.search('designer')
    expect(results).toHaveLength(1)
  })
})
