import type { ApplicationRecord } from '@shared/types'

interface Props { record: ApplicationRecord; onDismiss: () => void }

export function DuplicateWarning({ record, onDismiss }: Props) {
  return (
    <div className="mx-3 mt-2 rounded-lg border border-yellow-700 bg-yellow-950/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400 text-xs font-bold">⚠ Already Applied</span>
        </div>
        <button onClick={onDismiss} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
      </div>
      <p className="mt-1 text-xs text-yellow-300/80">
        {record.company && record.role
          ? `${record.company} — ${record.role}`
          : record.url}
        {' '}applied on {new Date(record.filled_at).toLocaleDateString()}.
      </p>
    </div>
  )
}
