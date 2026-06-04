import { useState } from 'react'
import { fileStore } from '../filestore'
import { settingsService } from '@shared/settings'
import { ProviderHealthCard } from './ProviderHealthCard'
import { sendToBackground } from '@shared/messaging'
import type { AppSettings, ProviderConfig } from '@shared/types'

interface Props {
  settings: AppSettings
  onSettingsChange: (s: AppSettings) => void
  onDataDeleted: () => void
}

export function Settings({ settings, onSettingsChange, onDataDeleted }: Props) {
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const save = async (updated: AppSettings) => {
    setSaving(true)
    try {
      await fileStore.writeSettings(settingsService.serialise(updated))
      // Cache LLM settings to chrome.storage.local so background SW can read
      // them without needing the folder handle
      await settingsService.cacheLLMSettings(updated)
      onSettingsChange(updated)
      setStatus('Saved.')
      setTimeout(() => setStatus(null), 2000)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const patchAndSave = (patch: Partial<AppSettings>) => save({ ...settings, ...patch })

  const saveProviderKey = async (id: string, key: string) => {
    setProviderKeys(prev => ({ ...prev, [id]: key }))
    await settingsService.setApiKey(id, key, settings)
  }

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    const updated = settings.providers.map(p => p.id === id ? { ...p, ...patch } : p) as ProviderConfig[]
    patchAndSave({ providers: updated })
  }

  const moveChain = (id: string, dir: -1 | 1) => {
    const chain = [...settings.fallbackChain]
    const idx = chain.indexOf(id)
    if (idx === -1) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= chain.length) return
    ;[chain[idx], chain[newIdx]] = [chain[newIdx], chain[idx]]
    patchAndSave({ fallbackChain: chain })
  }

  const toggleInChain = (id: string) => {
    const chain = settings.fallbackChain.includes(id)
      ? settings.fallbackChain.filter(x => x !== id)
      : [...settings.fallbackChain, id]
    patchAndSave({ fallbackChain: chain })
  }

  const deleteAllData = async () => {
    setDeleting(true)
    try {
      // Clear history and settings from disk
      await fileStore.writeHistory({ version: 1, applications: [] })
      const s = settingsService.parse({})
      await fileStore.writeSettings(settingsService.serialise(s))
      // Clear all API keys
      await settingsService.clearAllApiKeys(settings.providers.map(p => p.id))
      setDeleteConfirm(false)
      onDataDeleted()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  const downloadDebugLog = async () => {
    try {
      const entries = await sendToBackground<void, unknown[]>({
        type: 'GET_DEBUG_LOG',
        payload: undefined,
      })
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jff-debug-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setStatus(`Downloaded ${entries.length} log entries.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to fetch debug log.')
    }
    setTimeout(() => setStatus(null), 3000)
  }

  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto flex-1">
      {status && <p className="text-xs text-blue-400 bg-blue-950/40 rounded p-2">{status}</p>}

      {/* ── Fill behaviour ── */}
      <Section title="Fill behaviour">
        <Row label="Confidence threshold">
          <select
            value={settings.confidenceThreshold}
            onChange={e => patchAndSave({ confidenceThreshold: e.target.value as 'high' | 'medium' })}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          >
            <option value="high">High only (safest)</option>
            <option value="medium">Medium + High</option>
          </select>
        </Row>
        <Row label="AI drafting for custom questions">
          <Toggle value={settings.aiDrafting} onChange={v => patchAndSave({ aiDrafting: v })} />
        </Row>
        <Row label="Auto-add repeatable blocks">
          <Toggle value={settings.autoAddRepeatableBlocks} onChange={v => patchAndSave({ autoAddRepeatableBlocks: v })} />
        </Row>
        <Row label="Dedupe window (days)">
          <input
            type="number" min={1} max={3650}
            value={settings.dedupeWindow}
            onChange={e => patchAndSave({ dedupeWindow: parseInt(e.target.value) || 365 })}
            className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          />
        </Row>
        <Row label="LLM timeout (ms)">
          <input
            type="number" min={5000} max={120000} step={1000}
            value={settings.llmTimeoutMs}
            onChange={e => patchAndSave({ llmTimeoutMs: parseInt(e.target.value) || 30000 })}
            className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          />
        </Row>
        <Row label="Max field batch size">
          <input
            type="number" min={5} max={100}
            value={settings.maxFieldBatchSize}
            onChange={e => patchAndSave({ maxFieldBatchSize: parseInt(e.target.value) || 30 })}
            className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          />
        </Row>
      </Section>

      {/* ── Fallback chain ── */}
      <Section title="LLM fallback chain">
        <p className="text-[10px] text-gray-500 mb-2">Providers are tried in order. Toggle to include/exclude; use arrows to reorder.</p>
        <div className="flex flex-col gap-1">
          {settings.providers.map(p => {
            const inChain = settings.fallbackChain.includes(p.id)
            const idx = settings.fallbackChain.indexOf(p.id)
            return (
              <div key={p.id} className={`flex items-center gap-2 rounded px-2 py-1.5 border ${inChain ? 'border-blue-800 bg-blue-950/30' : 'border-gray-800 bg-gray-900/40'}`}>
                <input type="checkbox" checked={inChain} onChange={() => toggleInChain(p.id)} className="accent-blue-500" />
                <span className="text-xs text-gray-200 flex-1">{p.name}</span>
                {inChain && (
                  <>
                    <span className="text-[10px] text-gray-500">{idx + 1}</span>
                    <button onClick={() => moveChain(p.id, -1)} disabled={idx === 0} className="text-gray-500 hover:text-gray-200 disabled:opacity-30 text-xs">↑</button>
                    <button onClick={() => moveChain(p.id, 1)} disabled={idx === settings.fallbackChain.length - 1} className="text-gray-500 hover:text-gray-200 disabled:opacity-30 text-xs">↓</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* ── Providers ── */}
      <Section title="LLM providers">
        <div className="flex flex-col gap-2">
          {settings.providers.map(p => (
            <ProviderHealthCard
              key={p.id}
              provider={p}
              apiKey={providerKeys[p.id] ?? ''}
              onChange={patch => updateProvider(p.id, patch)}
              onKeyChange={key => saveProviderKey(p.id, key)}
            />
          ))}
        </div>
      </Section>

      {/* ── Security ── */}
      <Section title="Security">
        <Row label="Key persistence">
          <select
            value={settings.keyPersistenceMode}
            onChange={e => patchAndSave({ keyPersistenceMode: e.target.value as 'persisted' | 'session' })}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          >
            <option value="persisted">Persisted (survives reload)</option>
            <option value="session">Session-only (cleared on reload)</option>
          </select>
        </Row>
        <p className="text-[10px] text-gray-600 mt-1">Session-only mode clears API keys when the browser restarts. Keys are never written to disk.</p>
      </Section>

      {/* ── Data management ── */}
      <Section title="Data management">
        <p className="text-[10px] text-gray-500 mb-2">Clears history, settings, and API keys. Does not delete your profile or Q&amp;A markdown files.</p>
        {!deleteConfirm
          ? (
            <button onClick={() => setDeleteConfirm(true)}
              className="w-full py-1.5 rounded border border-red-800 bg-red-950/30 text-red-400 text-xs font-semibold hover:bg-red-900/40">
              Delete all local data…
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-red-400 font-semibold">Are you sure? This cannot be undone.</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteConfirm(false)} className="flex-1 py-1.5 rounded bg-gray-800 text-gray-300 text-xs">Cancel</button>
                <button onClick={deleteAllData} disabled={deleting}
                  className="flex-1 py-1.5 rounded bg-red-800 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50">
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            </div>
          )
        }
      </Section>

      {/* ── Debug ── */}
      <Section title="Debug">
        <button onClick={downloadDebugLog}
          className="w-full py-1.5 rounded border border-gray-700 bg-gray-900 text-gray-400 text-xs hover:bg-gray-800">
          Download debug log
        </button>
        {saving && <p className="text-[10px] text-gray-500 mt-1">Saving…</p>}
      </Section>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{title}</div>
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 flex flex-col gap-2">
        {children}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-300">{label}</span>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-9 h-5 rounded-full transition-colors shrink-0 ${value ? 'bg-blue-600' : 'bg-gray-700'}`}
    >
      <span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${value ? 'translate-x-4' : ''}`} />
    </button>
  )
}
