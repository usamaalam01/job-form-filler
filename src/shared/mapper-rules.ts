import type { DetectedField, MappingResult, ParsedProfile } from './types'
import { formatValue } from './value-formatter'

// ─── Profile value resolver ───────────────────────────────────────────────────

function resolveProfileValue(path: string, profile: ParsedProfile): string | null {
  const parts = path.split('.')
  const section = parts[0]

  if (section === 'personal') {
    const key = parts[1]
    // Try exact key then case-insensitive
    const value = profile.personal[key] ??
      Object.entries(profile.personal).find(([k]) => k.toLowerCase() === key?.toLowerCase())?.[1]
    return value ?? null
  }
  if (section === 'preferences') {
    const key = parts[1]
    const value = profile.preferences[key] ??
      Object.entries(profile.preferences).find(([k]) => k.toLowerCase() === key?.toLowerCase())?.[1]
    return value ?? null
  }
  if (section === 'experience' && profile.experience.length > 0) {
    const idx = parseInt(parts[1] ?? '0') || 0
    const exp = profile.experience[idx]
    if (!exp) return null
    const field = parts[2]
    if (field === 'title') return exp.title
    if (field === 'company') return exp.company
    if (field === 'start') return exp.start
    if (field === 'end') return exp.end
    if (field === 'location') return exp.location ?? null
    if (field === 'employmentType') return exp.employmentType ?? null
  }
  if (section === 'education' && profile.education.length > 0) {
    const idx = parseInt(parts[1] ?? '0') || 0
    const edu = profile.education[idx]
    if (!edu) return null
    const field = parts[2]
    if (field === 'degree') return edu.degree
    if (field === 'institution') return edu.institution
    if (field === 'start') return edu.start
    if (field === 'end') return edu.end
    if (field === 'grade') return edu.grade ?? null
    if (field === 'fieldOfStudy') return edu.fieldOfStudy ?? null
  }
  if (section === 'summary') return profile.summary ?? null
  return null
}

// ─── Rule definitions ─────────────────────────────────────────────────────────

interface Rule {
  patterns: RegExp[]
  profilePath: string
}

const RULES: Rule[] = [
  // Personal — name
  { patterns: [/^(full.?name|your.?name|legal.?name)$/i, /autocomplete:name/], profilePath: 'personal.Full name' },
  { patterns: [/^(first.?name|given.?name|forename)$/i, /autocomplete:given-name/], profilePath: 'personal.First name' },
  { patterns: [/^(last.?name|surname|family.?name)$/i, /autocomplete:family-name/], profilePath: 'personal.Last name' },
  { patterns: [/^middle.?name$/i, /autocomplete:additional-name/], profilePath: 'personal.Middle name' },
  // Personal — contact
  { patterns: [/^e.?mail(.*address)?$/i, /autocomplete:email/], profilePath: 'personal.Email' },
  { patterns: [/^(phone|mobile|tel|telephone|contact.?number)$/i, /autocomplete:tel/], profilePath: 'personal.Phone' },
  // Personal — location
  { patterns: [/^(city|town|suburb)$/i, /autocomplete:address-level2/], profilePath: 'personal.City' },
  { patterns: [/^(state|province|region)$/i, /autocomplete:address-level1/], profilePath: 'personal.State' },
  { patterns: [/^country$/i, /autocomplete:country-name/], profilePath: 'personal.Country' },
  { patterns: [/^(zip|postal.?code|post.?code)$/i, /autocomplete:postal-code/], profilePath: 'personal.Postal code' },
  { patterns: [/^(street|address.?line.?1|street.?address)$/i, /autocomplete:address-line1/], profilePath: 'personal.Location' },
  // Personal — links
  { patterns: [/linkedin/i], profilePath: 'personal.LinkedIn' },
  { patterns: [/github/i], profilePath: 'personal.GitHub' },
  { patterns: [/portfolio|personal.?url|website/i], profilePath: 'personal.Portfolio' },
  // Personal — identity
  { patterns: [/nationality/i], profilePath: 'personal.Nationality' },
  // Summary
  { patterns: [/^(professional\s+)?summary$/i, /^(about\s+me|about\s+you|cover\s+letter|personal\s+statement)$/i], profilePath: 'summary' },
  // Current position
  { patterns: [/^(current|present).?(title|position|role|job)$/i, /^(job|position).?title$/i], profilePath: 'experience.0.title' },
  { patterns: [/^(current|present).?(company|employer|organization)$/i, /^(company|employer)$/i], profilePath: 'experience.0.company' },
  // Dates
  { patterns: [/^(start|from|begin).?date$/i], profilePath: 'experience.0.start' },
  { patterns: [/^(end|to|finish).?date$/i], profilePath: 'experience.0.end' },
  // Education
  { patterns: [/^(degree|qualification|highest.?education)$/i], profilePath: 'education.0.degree' },
  { patterns: [/^(institution|university|school|college)$/i], profilePath: 'education.0.institution' },
  { patterns: [/^(field.?of.?study|major|discipline)$/i], profilePath: 'education.0.fieldOfStudy' },
  { patterns: [/^(gpa|grade|score|marks|cgpa|result)$/i], profilePath: 'education.0.grade' },
  { patterns: [/^graduation.?date$/i], profilePath: 'education.0.end' },
  // Preferences
  { patterns: [/^(notice.?period|availability|available.?from|start.?date)$/i], profilePath: 'preferences.Notice period' },
  { patterns: [/^(salary|expected.?salary|desired.?salary|compensation)$/i], profilePath: 'preferences.Salary expectation' },
  { patterns: [/^(work.?auth|authorization|eligible|legally.?authorized)$/i], profilePath: 'preferences.Work authorization' },
  { patterns: [/^(visa|sponsorship|require.?sponsor)$/i], profilePath: 'preferences.Visa status / sponsorship needed' },
  { patterns: [/^(relocat|willing.?to.?move)$/i], profilePath: 'preferences.Willing to relocate' },
  { patterns: [/^(earliest.?start|when.?can.?you.?start)$/i], profilePath: 'preferences.Earliest start date' },
]

// ─── Matcher ──────────────────────────────────────────────────────────────────

function matchField(field: DetectedField): Rule | null {
  const tokens = [
    field.label,
    field.name ?? '',
    field.id ?? '',
    field.autocomplete ? `autocomplete:${field.autocomplete}` : '',
  ].filter(Boolean)

  for (const rule of RULES) {
    for (const token of tokens) {
      if (rule.patterns.some(p => p.test(token))) return rule
    }
  }
  return null
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function applyRules(fields: DetectedField[], profile: ParsedProfile): MappingResult[] {
  return fields.map(field => {
    // Upload fields are always flagged — never mapped
    if (field.isUpload) {
      return {
        field,
        value: null,
        source: 'blank',
        confidence: 'low',
        needsReview: true,
        note: 'upload-field',
        include: false,
      }
    }

    const rule = matchField(field)
    if (!rule) {
      return {
        field,
        value: null,
        source: 'blank',
        confidence: 'low',
        needsReview: true,
        include: false,
      }
    }

    const rawValue = resolveProfileValue(rule.profilePath, profile)
    if (!rawValue) {
      return {
        field,
        value: null,
        source: 'blank',
        confidence: 'low',
        needsReview: true,
        include: false,
      }
    }

    const { value, note } = formatValue(rawValue, field)
    return {
      field,
      value,
      source: 'rule',
      confidence: 'high',
      needsReview: note === 'no-matching-option' || note === 'truncated',
      note,
      include: true,
    }
  })
}
