import { useState, useMemo } from 'react'
import { usePanelStore } from '../store/panelStore'
import { fileStore } from '../filestore'
import { HistoryService } from '@shared/history'
import type { ApplicationRecord } from '@shared/types'

const STATUS_LABELS: Record<ApplicationRecord['status'], string> = {
  'filled': 'Filled',
  'submitted-manually': 'Submitted',
  'abandoned': 'Abandoned',
}

const STATUS_COLORS: Record<ApplicationRecord['status'], string> = {
  'filled': 'text-blue-400',
  'submitted-manually': 'text-green-400',
  'abandoned': 'text-gray-500',
}

type SortKey = 'date' | 'company' | 'status'

export function HistoryView() {
  const { history, setHistory } = usePanelStore()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortAsc, setSortAsc] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Filter
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return q
      ? history.filter(r =>
          r.company?.toLowerCase().includes(q) ||
          r.role?.toLowerCase().includes(q) ||
          r.url.toLowerCase().includes(q) ||
          r.profile_used.toLowerCase().includes(q)
        )
      : history
  }, [history, query])

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date') cmp = new Date(b.filled_at).getTime() - new Date(a.filled_at).getTime()
      else if (sortKey === 'company') cmp = (a.company ?? '').localeCompare(b.company ?? '')
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status)
      return sortAsc ? -cmp : cmp
    })
  }, [filtered, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const updateStatus = async (id: string, status: ApplicationRecord['status']) => {
    const histSvc = new HistoryService(fileStore)
    await histSvc.updateStatus(id, status)
    setHistory(history.map(r => r.id === id ? { ...r, status } : r))
  }

  const deleteEntry = async (id: string) => {
    setDeletingId(id)
    try {
      const histSvc = new HistoryService(fileStore)
      const h = await histSvc.load()
      h.applications = h.applications.filter(a => a.id !== id)
      await fileStore.writeHistory(h)
      setHistory(history.filter(r => r.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-600 text-xs gap-2">
        <span className="text-2xl">📋</span>
        No applications recorded yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 pt-2 pb-1 shrink-0">
        <input
          type="text"
          placeholder="Search company, role, URL, profile…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Sort controls */}
      <div className="flex gap-1 px-3 pb-1 shrink-0">
        {(['date', 'company', 'status'] as SortKey[]).map(k => (
          <button key={k} onClick={() => toggleSort(k)}
            className={`text-[10px] px-2 py-0.5 rounded capitalize ${sortKey === k ? 'bg-blue-800 text-blue-200' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}>
            {k} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-gray-600 self-center">{sorted.length} entries</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-1.5">
        {sorted.map(r => (
          <div key={r.id} className="rounded-lg border border-gray-800 bg-gray-900/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-gray-200 truncate">
                    {r.company ?? '—'}
                  </span>
                  {r.role && <span className="text-xs text-gray-400 truncate">— {r.role}</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`text-[10px] font-semibold ${STATUS_COLORS[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                  <span className="text-[10px] text-gray-600">
                    {new Date(r.filled_at).toLocaleDateString()}
                  </span>
                  <span className="text-[10px] text-gray-600">
                    {r.fields_filled}✓ {r.fields_flagged}⚑
                  </span>
                  <span className="text-[10px] text-gray-700 truncate max-w-[100px]" title={r.profile_used}>
                    {r.profile_used}
                  </span>
                </div>
                <div className="text-[10px] text-gray-600 truncate mt-0.5" title={r.url}>{r.url}</div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-1 shrink-0">
                <select
                  value={r.status}
                  onChange={e => updateStatus(r.id, e.target.value as ApplicationRecord['status'])}
                  className="text-[10px] bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300"
                >
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <div className="flex gap-1">
                  <a href={r.url} target="_blank" rel="noreferrer"
                    className="flex-1 text-center text-[10px] px-1 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
                    title="Open URL">
                    ↗
                  </a>
                  <button
                    onClick={() => deleteEntry(r.id)}
                    disabled={deletingId === r.id}
                    className="flex-1 text-[10px] px-1 py-0.5 rounded bg-red-950/60 hover:bg-red-900/60 text-red-400 disabled:opacity-40"
                    title="Delete entry">
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
