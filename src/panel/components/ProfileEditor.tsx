import { useState, useEffect } from 'react'
import { fileStore } from '../filestore'
import { usePanelStore } from '../store/panelStore'

interface Props { onClose: () => void }

export function ProfileEditor({ onClose }: Props) {
  const { activeProfile } = usePanelStore()
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeProfile) return
    fileStore.readProfile(activeProfile).then(md => setContent(md ?? ''))
  }, [activeProfile])

  const save = async () => {
    if (!activeProfile) return
    setSaving(true)
    setError(null)
    try {
      // Re-read before writing (§7.5.1 write-safety) — FileStore handles this internally
      await fileStore.writeProfile(activeProfile, content)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-semibold text-gray-300">Edit: {activeProfile}</span>
        <div className="flex gap-1.5">
          <button onClick={onClose} className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-400">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-400 px-3 py-1">{error}</p>}
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        spellCheck={false}
        className="flex-1 bg-gray-950 text-gray-200 text-xs font-mono p-3 resize-none focus:outline-none"
      />
    </div>
  )
}
