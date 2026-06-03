import type { DetectedField, MappingResult, ParsedProfile, QAEntry, LLMMappingResponse, LLMMappingResultItem, MappingSource, Confidence } from '@shared/types'
import type { FallbackChain } from './llm/fallback'

// ─── Profile context compaction ───────────────────────────────────────────────

const PERSONAL_KEYWORDS = /name|email|phone|tel|mobile|address|city|country|state|zip|postal|linkedin|github|portfolio|website|nationality/i
const EXPERIENCE_KEYWORDS = /experience|job|work|employment|position|title|company|employer|start|end|duration|current/i
const EDUCATION_KEYWORDS = /education|degree|university|school|college|graduation|major|field|gpa|grade|qualification/i
const CERT_KEYWORDS = /certification|certificate|credential|license|issued|expires/i
const SKILL_KEYWORDS = /skill|technology|language|framework|tool|proficien/i
const PREF_KEYWORDS = /salary|compensation|notice|reloc|visa|sponsor|authoriz|availab|start date/i

function compactContext(fields: DetectedField[], profile: ParsedProfile): string {
  const labels = fields.map(f => f.label.toLowerCase()).join(' ')
  const sections: string[] = []

  if (PERSONAL_KEYWORDS.test(labels) && Object.keys(profile.personal).length) {
    sections.push('# Personal Information\n' +
      Object.entries(profile.personal).map(([k, v]) => `- ${k}: ${v}`).join('\n'))
  }
  if (EXPERIENCE_KEYWORDS.test(labels) && profile.experience.length) {
    sections.push('# Work Experience\n' + profile.experience.map(e =>
      `## ${e.title} — ${e.company}\n- Start: ${e.start}\n- End: ${e.end}${e.location ? `\n- Location: ${e.location}` : ''}`
    ).join('\n\n'))
  }
  if (EDUCATION_KEYWORDS.test(labels) && profile.education.length) {
    sections.push('# Education\n' + profile.education.map(e =>
      `## ${e.degree} — ${e.institution}\n- Start: ${e.start}\n- End: ${e.end}${e.grade ? `\n- Grade: ${e.grade}` : ''}${e.fieldOfStudy ? `\n- Field: ${e.fieldOfStudy}` : ''}`
    ).join('\n\n'))
  }
  if (CERT_KEYWORDS.test(labels) && profile.certifications.length) {
    sections.push('# Certifications\n' + profile.certifications.map(c =>
      `## ${c.name}${c.issuer ? `\n- Issuer: ${c.issuer}` : ''}${c.issued ? `\n- Issued: ${c.issued}` : ''}${c.expires ? `\n- Expires: ${c.expires}` : ''}`
    ).join('\n\n'))
  }
  if (SKILL_KEYWORDS.test(labels) && Object.keys(profile.skills).length) {
    sections.push('# Skills\n' + Object.entries(profile.skills)
      .map(([k, v]) => `- ${k}: ${v.join(', ')}`).join('\n'))
  }
  if (PREF_KEYWORDS.test(labels) && Object.keys(profile.preferences).length) {
    sections.push('# Preferences\n' + Object.entries(profile.preferences)
      .map(([k, v]) => `- ${k}: ${v}`).join('\n'))
  }

  // Always include summary if available and context is thin
  if (profile.summary && sections.length === 0) {
    sections.push(`# Professional Summary\n${profile.summary}`)
  }

  return sections.length ? sections.join('\n\n') : 'No relevant profile data available.'
}

// ─── JSON output validation ───────────────────────────────────────────────────

const VALID_SOURCES = new Set(['profile', 'qa', 'llm', 'blank'])
const VALID_CONFIDENCES = new Set(['high', 'medium', 'low'])

function validateResponse(raw: unknown, fieldIds: Set<string>): LLMMappingResponse {
  if (typeof raw !== 'object' || raw === null) throw new Error('Not an object.')
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj['results'])) throw new Error('Missing results array.')
  const results: LLMMappingResultItem[] = []
  for (const item of obj['results']) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const fieldId = String(r['fieldId'] ?? '')
    if (!fieldIds.has(fieldId)) continue
    const source = VALID_SOURCES.has(String(r['source'])) ? String(r['source']) as MappingSource : 'blank'
    const confidence = VALID_CONFIDENCES.has(String(r['confidence'])) ? String(r['confidence']) as Confidence : 'low'
    results.push({
      fieldId,
      value: r['value'] !== undefined ? (r['value'] === null ? null : String(r['value'])) : null,
      source: source === 'rule' ? 'llm' : source, // LLM cannot claim 'rule'
      confidence,
      note: r['note'] !== undefined && r['note'] !== null ? String(r['note']) : null,
    })
  }
  return { results }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a form-filling assistant. Given a user's profile and a list of form fields, map the correct value to each field.

Rules:
- Use ONLY values explicitly present in the profile. Never invent or hallucinate facts.
- If a value is unknown, return null and source "blank".
- Return confidence: "high" if the value is a direct, unambiguous match; "medium" if inferred; "low" if uncertain.
- Return source: "profile" for profile data, "blank" if unknown.
- Return ONLY valid JSON matching the schema. No prose outside JSON.`

function buildUserPrompt(fields: DetectedField[], profileContext: string): string {
  const fieldList = fields.map(f => ({
    fieldId: f.fieldId,
    label: f.label,
    type: f.type,
    options: f.options?.slice(0, 20), // cap option list length
    group: f.group,
    required: f.required,
  }))
  return `Profile data:\n${profileContext}\n\nForm fields to fill:\n${JSON.stringify(fieldList, null, 2)}\n\nRespond with JSON:\n{"results":[{"fieldId":"...","value":"...","source":"profile|blank","confidence":"high|medium|low","note":null}]}`
}

function buildRepairPrompt(badOutput: string, error: string): string {
  return `Your previous response was invalid: ${error}\nBad output: ${badOutput.slice(0, 500)}\nReturn ONLY valid JSON with the same schema.`
}

// ─── Batch runner ─────────────────────────────────────────────────────────────

async function processBatch(
  batch: DetectedField[],
  profile: ParsedProfile,
  chain: FallbackChain,
): Promise<MappingResult[]> {
  const fieldIds = new Set(batch.map(f => f.fieldId))
  const profileContext = compactContext(batch, profile)
  const userPrompt = buildUserPrompt(batch, profileContext)

  let parsed: LLMMappingResponse
  let rawOutput = ''

  try {
    const res = await chain.complete({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      responseSchema: {},
      maxTokens: 1024,
    })
    rawOutput = res.content

    let jsonText = rawOutput.trim()
    // Strip markdown code fences if present
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

    parsed = validateResponse(JSON.parse(jsonText), fieldIds)
  } catch (firstErr) {
    // One repair attempt
    try {
      const repairRes = await chain.complete({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildRepairPrompt(rawOutput, String(firstErr)),
        responseSchema: {},
        maxTokens: 1024,
      })
      let jsonText = repairRes.content.trim()
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      parsed = validateResponse(JSON.parse(jsonText), fieldIds)
    } catch {
      // Both failed — return blank for all fields in this batch
      return batch.map(f => ({
        field: f,
        value: null,
        source: 'blank',
        confidence: 'low',
        needsReview: true,
        note: 'llm-parse-failed',
        include: false,
      }))
    }
  }

  // Build a map from fieldId → result
  const resultMap = new Map(parsed.results.map(r => [r.fieldId, r]))

  return batch.map(f => {
    const r = resultMap.get(f.fieldId)
    if (!r || r.value === null) {
      return { field: f, value: null, source: 'blank' as const, confidence: 'low' as const, needsReview: true, include: false }
    }
    return {
      field: f,
      value: r.value,
      source: r.source,
      confidence: r.confidence,
      needsReview: r.confidence !== 'high',
      note: r.note ?? undefined,
      include: r.confidence === 'high',
    }
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function mapFieldsWithLLM(
  unresolvedFields: DetectedField[],
  profile: ParsedProfile,
  _qaBank: QAEntry[],
  chain: FallbackChain,
  batchSize: number,
): Promise<MappingResult[]> {
  if (unresolvedFields.length === 0) return []

  const results: MappingResult[] = []
  for (let i = 0; i < unresolvedFields.length; i += batchSize) {
    const batch = unresolvedFields.slice(i, i + batchSize)
    const batchResults = await processBatch(batch, profile, chain)
    results.push(...batchResults)
  }
  return results
}
