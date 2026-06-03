import type { DetectedField, Confidence } from './types'

// ─── Degree synonyms for fuzzy option matching ────────────────────────────────

const SYNONYMS: Array<[string[], string[]]> = [
  [['bachelor', 'bsc', 'bs', 'undergraduate', 'bachelors'], ['bachelor', 'bsc', 'bs', 'undergraduate', 'bachelors']],
  [['master', 'msc', 'ms', 'graduate', 'masters', 'mba'], ['master', 'msc', 'ms', 'graduate', 'masters', 'mba']],
  [['phd', 'doctorate', 'doctoral', 'dphil'], ['phd', 'doctorate', 'doctoral', 'dphil']],
  [['associate', 'aa', 'as'], ['associate', 'aa', 'as']],
  [['diploma', 'certificate', 'cert'], ['diploma', 'certificate', 'cert']],
  [['high school', 'secondary', 'gcse', 'a-level', 'alevel', 'matric', 'matriculation'], ['high school', 'secondary', 'gcse', 'matric']],
  [['full-time', 'fulltime', 'full time'], ['full-time', 'fulltime', 'full time']],
  [['part-time', 'parttime', 'part time'], ['part-time', 'parttime', 'part time']],
  [['contract', 'contractor', 'freelance'], ['contract', 'contractor', 'freelance']],
  [['yes', 'true', '1', 'y'], ['yes', 'true', '1', 'y']],
  [['no', 'false', '0', 'n'], ['no', 'false', '0', 'n']],
]

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function synonymGroup(s: string): string[] | null {
  for (const [group] of SYNONYMS) {
    if (group.some(syn => s === syn || s.startsWith(syn + ' ') || s.endsWith(' ' + syn) || s.includes(' ' + syn + ' '))) {
      return group
    }
  }
  return null
}

export function fuzzyMatchOption(
  raw: string,
  options: string[],
): { match: string | null; confidence: Confidence } {
  const normRaw = normalize(raw)
  // Exact match
  for (const opt of options) {
    if (normalize(opt) === normRaw) return { match: opt, confidence: 'high' }
  }
  // Synonym match
  const rawGroup = synonymGroup(normRaw)
  if (rawGroup) {
    for (const opt of options) {
      if (synonymGroup(normalize(opt)) === rawGroup) return { match: opt, confidence: 'high' }
      if (rawGroup.some(syn => normalize(opt).includes(syn))) return { match: opt, confidence: 'high' }
    }
  }
  // Substring: raw contains option text or vice versa — require ≥4 chars to avoid false positives
  if (normRaw.length >= 4) {
    for (const opt of options) {
      const normOpt = normalize(opt)
      if (normOpt.length >= 4 && (normOpt.includes(normRaw) || normRaw.includes(normOpt))) {
        return { match: opt, confidence: 'medium' }
      }
    }
  }
  // Levenshtein ≤ 2 — only for similarly-lengthed strings to avoid false positives
  for (const opt of options) {
    const normOpt = normalize(opt)
    if (Math.abs(normRaw.length - normOpt.length) <= 3 && levenshtein(normRaw, normOpt) <= 2) {
      return { match: opt, confidence: 'medium' }
    }
  }
  return { match: null, confidence: 'low' }
}

// ─── Date formatting ──────────────────────────────────────────────────────────

export function formatDate(raw: string, field: DetectedField): string {
  if (!raw) return raw
  const lower = raw.toLowerCase().trim()
  if (lower === 'present' || lower === 'current') return raw // caller handles "present"

  // Parse YYYY-MM or YYYY-MM-DD
  const fullDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const monthDate = raw.match(/^(\d{4})-(\d{2})$/)

  if (!fullDate && !monthDate) return raw // not a date we know, pass through

  const year = fullDate?.[1] ?? monthDate?.[1] ?? ''
  const month = fullDate?.[2] ?? monthDate?.[2] ?? '01'
  const day = fullDate?.[3] ?? '01'

  // Detect target format
  if (field.type === 'month') return `${year}-${month}`
  if (field.type === 'date') return `${year}-${month}-${day}`

  // Use the field type + options as proxy for expected format
  if (field.options) {
    // Likely a year-only select
    if (field.options.every(o => /^\d{4}$/.test(o.trim()))) return year
    // Month select (numeric or named)
    if (field.options.length >= 12 && field.options.length <= 13) return String(parseInt(month))
  }

  // Default: return in ISO format
  return `${year}-${month}-${day}`
}

// ─── Main value formatter ─────────────────────────────────────────────────────

export function formatValue(
  raw: string,
  field: DetectedField,
): { value: string; note?: string } {
  if (!raw) return { value: raw }

  // Date fields
  if (field.type === 'date' || field.type === 'month') {
    return { value: formatDate(raw, field) }
  }

  // Select / radio: try to fuzzy-match to one of the available options
  if ((field.type === 'select' || field.type === 'radio') && field.options?.length) {
    const { match, confidence } = fuzzyMatchOption(raw, field.options)
    if (match) return { value: match }
    if (confidence === 'low') return { value: raw, note: 'no-matching-option' }
  }

  // Enforce maxLength
  if (field.maxLength && raw.length > field.maxLength) {
    return { value: raw.slice(0, field.maxLength), note: 'truncated' }
  }

  return { value: raw }
}
