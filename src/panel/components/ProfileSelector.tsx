import { usePanelStore } from '../store/panelStore'

interface Props {
  onEdit: () => void
  onNew: () => void
}

export function ProfileSelector({ onEdit, onNew }: Props) {
  const { profiles, activeProfile, setActiveProfile } = usePanelStore()

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
    </div>
  )
}
