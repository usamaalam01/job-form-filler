interface Props {
  original: string | null
  updated: string
  onConfirm: () => void
  onCancel: () => void
  saving?: boolean
}

export function DiffPreview({ original, updated, onConfirm, onCancel, saving }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-semibold text-gray-300">
          {original ? 'Review changes' : 'New profile preview'}
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Confirm & Save'}
          </button>
        </div>
      </div>

      {original && (
        <div className="px-3 py-1.5 bg-yellow-950/40 border-b border-yellow-900/50 text-[10px] text-yellow-400">
          ⚠ This will overwrite the existing profile. Review carefully before confirming.
        </div>
      )}

      <div className="flex flex-1 overflow-hidden divide-x divide-gray-800 text-xs font-mono">
        {original && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-2 py-1 bg-red-950/40 text-red-400 font-bold text-[10px]">Current (will be replaced)</div>
            <pre className="p-3 text-red-300/70 text-[10px] whitespace-pre-wrap leading-relaxed">{original}</pre>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <div className="px-2 py-1 bg-green-950/40 text-green-400 font-bold text-[10px]">
            {original ? 'New version' : 'Generated profile'}
          </div>
          <pre className="p-3 text-green-300/80 text-[10px] whitespace-pre-wrap leading-relaxed">{updated}</pre>
        </div>
      </div>
    </div>
  )
}
