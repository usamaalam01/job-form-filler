import { useState } from 'react'
import { usePanelStore } from '../store/panelStore'
import { sendToBackground } from '@shared/messaging'
import type { ApplicationRecord } from '@shared/types'

const STATUS_LABELS: Record<ApplicationRecord['status'], string> = {
  'filled': 'Filled',
  'submitted-manually': 'Submitted',
  'abandoned': 'Abandoned',
}

export function HistoryView() {
  const { history, setHistory } = usePanelStore()
  const [query, setQuery] = useState('')

  const filtered = query
    ? history.filter(r =>
        r.company?.toLowerCase().includes(query.toLowerCase()) ||
        r.role?.toLowerCase().includes(query.toLowerCase()) ||
        r.url.toLowerCase().includes(query.toLowerCase())
      )
    : history

  const updateStatus = async (id: string, status: ApplicationRecord['status']) => {
    await sendToBackground({ type: 'HISTORY_UPDATE_STATUS', payload: { id, status } })
    setHistory(history.map(r => r.id === id ? { ...r, status } : r))
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-600 text-xs">
        No applications recorded yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <input
        type="text"
        placeholder="Search company, role, URL…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
      />
      <div className="flex flex-col gap-1.5">
        {filtered.map(r => (
          <div key={r.id} className="rounded-lg border border-gray-800 bg-gray-900/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-200 truncate">
                  {r.company ?? '—'} {r.role ? `— ${r.role}` : ''}
                </div>
                <div className="text-[10px] text-gray-500 truncate">{r.url}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">
                  {new Date(r.filled_at).toLocaleDateString()} · {r.fields_filled} filled · {r.fields_flagged} flagged
                </div>
              </div>
              <select
                value={r.status}
                onChange={e => updateStatus(r.id, e.target.value as ApplicationRecord['status'])}
                className="text-[10px] bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 shrink-0"
              >
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
