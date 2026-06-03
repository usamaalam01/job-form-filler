import type { MappingResult, Confidence, MappingSource } from '@shared/types'

const SOURCE_COLORS: Record<MappingSource, string> = {
  rule:    'bg-blue-900/60 text-blue-300',
  profile: 'bg-purple-900/60 text-purple-300',
  qa:      'bg-teal-900/60 text-teal-300',
  llm:     'bg-pink-900/60 text-pink-300',
  blank:   'bg-gray-800 text-gray-500',
}
const CONF_COLORS: Record<Confidence, string> = {
  high:   'text-green-400',
  medium: 'text-yellow-400',
  low:    'text-red-400',
}

interface Props {
  result: MappingResult
  onChange: (value: string) => void
  onToggle: (include: boolean) => void
}

export function ReviewRow({ result, onChange, onToggle }: Props) {
  const { field, value, source, confidence, needsReview, include, note } = result
  const displayValue = value === null ? '' : String(value)

  return (
    <div className={`grid grid-cols-[1fr_auto] gap-x-2 px-3 py-2 border-b border-gray-800 text-xs ${
      !include ? 'opacity-50' : needsReview ? 'bg-yellow-950/20' : ''
    }`}>
      {/* Label + badges */}
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-gray-200 truncate max-w-[140px]" title={field.label}>
            {field.label || '(unlabelled)'}
          </span>
          {field.required && <span className="text-yellow-500 text-xs shrink-0">*</span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${SOURCE_COLORS[source]}`}>
            {source}
          </span>
          <span className={`text-[10px] font-semibold ${CONF_COLORS[confidence]}`}>
            {confidence}
          </span>
          {note === 'truncated' && <span className="text-[10px] text-orange-400">truncated</span>}
        </div>
        {/* Editable value */}
        <input
          type="text"
          value={displayValue}
          onChange={e => onChange(e.target.value)}
          disabled={!include}
          placeholder={source === 'blank' ? '— unfilled —' : ''}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-40"
        />
      </div>
      {/* Include toggle */}
      <div className="flex items-center pt-5">
        <button
          onClick={() => onToggle(!include)}
          className={`w-9 h-5 rounded-full transition-colors ${include ? 'bg-blue-600' : 'bg-gray-700'}`}
          title={include ? 'Click to skip' : 'Click to include'}
        >
          <span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${include ? 'translate-x-4' : ''}`} />
        </button>
      </div>
    </div>
  )
}
