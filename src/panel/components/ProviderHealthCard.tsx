import { useState } from 'react'
import { sendToBackground } from '@shared/messaging'
import type { ProviderConfig } from '@shared/types'

interface HealthResult { ok: boolean; latencyMs?: number; error?: string }
type HealthStatus = 'untested' | 'ok' | 'error' | 'testing'

interface Props {
  provider: ProviderConfig
  apiKey: string
  onChange: (patch: Partial<ProviderConfig>) => void
  onKeyChange: (key: string) => void
}

export function ProviderHealthCard({ provider, apiKey, onChange, onKeyChange }: Props) {
  const [status, setStatus] = useState<HealthStatus>('untested')
  const [result, setResult] = useState<HealthResult | null>(null)
  const [showKey, setShowKey] = useState(false)

  const test = async () => {
    setStatus('testing')
    try {
      const r = await sendToBackground<{ providerId: string; model: string; baseUrl: string; apiKey: string }, HealthResult>({
        type: 'TEST_PROVIDER',
        payload: { providerId: provider.id, model: provider.model, baseUrl: provider.baseUrl, apiKey },
      })
      setResult(r)
      setStatus(r.ok ? 'ok' : 'error')
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' })
      setStatus('error')
    }
  }

  const statusDot = {
    untested: 'bg-gray-600',
    ok:       'bg-green-500',
    error:    'bg-red-500',
    testing:  'bg-yellow-400 animate-pulse',
  }[status]

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
        <span className="text-xs font-bold text-gray-200">{provider.name}</span>
        <span className="ml-auto text-[10px] text-gray-600">{provider.id}</span>
      </div>

      {/* Model */}
      <div>
        <label className="text-[10px] text-gray-500 block mb-0.5">Model</label>
        <input
          type="text"
          value={provider.model}
          onChange={e => onChange({ model: e.target.value })}
          placeholder="e.g. gpt-4o / claude-sonnet-4-6 / gemini-1.5-flash"
          className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Base URL (only show for custom) */}
      {provider.id === 'custom' && (
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">Base URL</label>
          <input
            type="url"
            value={provider.baseUrl}
            onChange={e => onChange({ baseUrl: e.target.value })}
            placeholder="https://your-endpoint.com/v1"
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* API Key */}
      <div>
        <label className="text-[10px] text-gray-500 block mb-0.5">API Key</label>
        <div className="flex gap-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => onKeyChange(e.target.value)}
            placeholder="Paste API key…"
            className="flex-1 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => setShowKey(s => !s)}
            className="px-1.5 text-gray-500 hover:text-gray-300 text-xs"
            title={showKey ? 'Hide' : 'Show'}
          >
            {showKey ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      {/* Test button + result */}
      <div className="flex items-center gap-2">
        <button
          onClick={test}
          disabled={status === 'testing' || !provider.model || !apiKey}
          className="px-3 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40"
        >
          {status === 'testing' ? 'Testing…' : 'Test'}
        </button>
        {result && (
          <span className={`text-[10px] ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
            {result.ok ? `✓ ${result.latencyMs}ms` : `✗ ${result.error?.slice(0, 60)}`}
          </span>
        )}
      </div>
    </div>
  )
}
