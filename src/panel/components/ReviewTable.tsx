import { usePanelStore } from '../store/panelStore'
import { ReviewRow } from './ReviewRow'
import type { MappingResult } from '@shared/types'

interface Props {
  results: MappingResult[]
}

export function ReviewTable({ results }: Props) {
  const { updateMappingResult } = usePanelStore()

  if (results.length === 0) {
    return <p className="text-gray-500 text-xs px-3 py-6 text-center">No fields detected yet.</p>
  }

  // Group by field.group
  const grouped = new Map<string, MappingResult[]>()
  for (const r of results) {
    if (r.field.isUpload) continue // uploads shown in FlaggedItems
    const key = r.field.group ?? '—'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(r)
  }

  return (
    <div className="flex flex-col">
      {[...grouped.entries()].map(([group, rows]) => (
        <div key={group}>
          {group !== '—' && (
            <div className="px-3 py-1.5 bg-gray-800/60 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              {group}
            </div>
          )}
          {rows.map(r => (
            <ReviewRow
              key={r.field.fieldId}
              result={r}
              onChange={value => updateMappingResult(r.field.fieldId, { value })}
              onToggle={include => updateMappingResult(r.field.fieldId, { include })}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
