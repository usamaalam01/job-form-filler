import type { MappingResult } from '@shared/types'

interface Props { results: MappingResult[] }

export function FlaggedItems({ results }: Props) {
  const flagged = results.filter(r => r.needsReview || !r.include || r.note === 'upload-field')
  if (flagged.length === 0) return null

  return (
    <div className="mx-3 mt-2">
      <div className="text-xs font-bold text-red-400 mb-1">
        ⚑ Flagged items ({flagged.length})
      </div>
      <div className="rounded-lg border border-red-900 bg-red-950/40 divide-y divide-red-900/50">
        {flagged.map(r => (
          <div key={r.field.fieldId} className="flex items-center gap-2 px-3 py-2">
            <span className="text-red-400 text-xs min-w-0 flex-1 truncate">{r.field.label || '(unlabelled)'}</span>
            <span className="text-xs text-gray-500 shrink-0">
              {r.note === 'upload-field' ? '📎 upload' :
               r.note === 'required-unfilled' ? '⚠ required' :
               r.note === 'fact-not-in-profile' ? '❓ unknown' :
               r.note === 'no-matching-option' ? '❌ no match' :
               r.note ?? 'review'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
