import { useState } from 'react'
import { fileStore } from '../filestore'
import { sendToBackground } from '@shared/messaging'
import { DiffPreview } from './DiffPreview'

interface Props {
  activeProfile: string | null
  onSaved: () => void
  onClose: () => void
}

export function ProfileBuilder({ activeProfile, onSaved, onClose }: Props) {
  const [rawText, setRawText] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [structuredMd, setStructuredMd] = useState<string | null>(null)
  const [existingMd, setExistingMd] = useState<string | null>(null)
  const [isStructuring, setIsStructuring] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const structure = async () => {
    if (!rawText.trim()) return
    setIsStructuring(true)
    setError(null)
    try {
      const existing = activeProfile ? await fileStore.readProfile(activeProfile) : null
      setExistingMd(existing)
      const result = await sendToBackground<{ rawText: string; targetRole: string }, string>({
        type: 'LOAD_PROFILE',
        payload: { rawText, targetRole },
      })
      setStructuredMd(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to structure profile.')
    } finally {
      setIsStructuring(false)
    }
  }

  const save = async () => {
    if (!structuredMd || !activeProfile) return
    setIsSaving(true)
    try {
      await fileStore.writeProfile(activeProfile, structuredMd)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setIsSaving(false)
    }
  }

  if (structuredMd !== null) {
    return (
      <DiffPreview
        original={existingMd}
        updated={structuredMd}
        onConfirm={save}
        onCancel={() => setStructuredMd(null)}
        saving={isSaving}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-semibold text-gray-300">Build profile from text</span>
        <button onClick={onClose} className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-400">✕</button>
      </div>

      <div className="flex flex-col gap-2 p-3 flex-1 overflow-y-auto">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Target role (optional)</label>
          <input
            type="text"
            value={targetRole}
            onChange={e => setTargetRole(e.target.value)}
            placeholder="e.g. Machine Learning Engineer"
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-400 mb-1 block">
            Paste your resume text, cert details, or any profile information
          </label>
          <textarea
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            placeholder="Paste your resume, LinkedIn summary, or any free-form career text here…"
            spellCheck={false}
            className="w-full min-h-[200px] bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500 resize-y"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          onClick={structure}
          disabled={isStructuring || !rawText.trim()}
          className="w-full py-2 rounded-lg bg-purple-700 hover:bg-purple-600 text-white text-xs font-semibold disabled:opacity-40"
        >
          {isStructuring ? 'Structuring with AI…' : 'Structure with AI'}
        </button>

        {!activeProfile && (
          <p className="text-[10px] text-yellow-500">
            ⚠ No active profile selected. Create or select a profile first.
          </p>
        )}
      </div>
    </div>
  )
}
