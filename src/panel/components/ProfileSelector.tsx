import { useRef } from 'react'
import { usePanelStore } from '../store/panelStore'
import { fileStore } from '../filestore'

interface Props {
  onEdit: () => void
  onNew: () => void
  onImported: () => void
}

export function ProfileSelector({ onEdit, onNew, onImported }: Props) {
  const { profiles, activeProfile, setActiveProfile } = usePanelStore()
  const importRef = useRef<HTMLInputElement>(null)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    // Derive slug from filename (strip .md extension)
    const slug = file.name.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    await fileStore.writeProfile(slug, text)
    setActiveProfile(slug)
    onImported()
    // Reset input so same file can be imported again if needed
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-800">
      <select
        value={activeProfile ?? ''}
        onChange={e => setActiveProfile(e.target.value || null)}
        className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
      >
        <option value="">— Select profile —</option>
        {profiles.map(slug => (
          <option key={slug} value={slug}>{slug}</option>
        ))}
      </select>
      <button
        onClick={onEdit}
        disabled={!activeProfile}
        title="Edit profile"
        className="px-2 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300"
      >✏</button>
      <button
        onClick={onNew}
        title="New profile"
        className="px-2 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
      >＋</button>
      <button
        onClick={() => importRef.current?.click()}
        title="Import profile from .md file"
        className="px-2 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
      >⬆</button>
      <input
        ref={importRef}
        type="file"
        accept=".md,text/markdown,text/plain"
        className="hidden"
        onChange={handleImport}
      />
    </div>
  )
}
