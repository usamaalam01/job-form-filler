import type { DetectedField, MappingResult, ParsedProfile, QAEntry } from '@shared/types'
import type { FallbackChain } from './llm/fallback'
import { FallbackExhaustedError } from './llm/provider'

// ─── Text normalisation ───────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

// ─── Scoring: tag overlap + substring similarity ──────────────────────────────

function scoreEntry(label: string, entry: QAEntry): number {
  const normLabel = norm(label)
  const normQ = norm(entry.question)
  let score = 0

  // Tag keyword match
  for (const tag of entry.tags) {
    if (normLabel.includes(norm(tag))) score += 2
  }

  // Exact question match
  if (normQ === normLabel) score += 5

  // Substring overlap
  const qWords = normQ.split(' ').filter(w => w.length > 3)
  for (const word of qWords) {
    if (normLabel.includes(word)) score += 1
  }
  const labelWords = normLabel.split(' ').filter(w => w.length > 3)
  for (const word of labelWords) {
    if (normQ.includes(word)) score += 1
  }

  return score
}

const RULE_MATCH_THRESHOLD = 2

// ─── Compact profile context for drafting ────────────────────────────────────

function compactProfileForDrafting(profile: ParsedProfile): string {
  const lines: string[] = []
  if (Object.keys(profile.personal).length) {
    lines.push('Personal:', ...Object.entries(profile.personal).map(([k, v]) => `  ${k}: ${v}`))
  }
  if (Object.keys(profile.preferences).length) {
    lines.push('Preferences:', ...Object.entries(profile.preferences).map(([k, v]) => `  ${k}: ${v}`))
  }
  if (profile.experience.length) {
    lines.push('Recent experience:',
      ...profile.experience.slice(0, 2).map(e => `  ${e.title} at ${e.company} (${e.start}–${e.end})`)
    )
  }
  return lines.join('\n') || 'No profile data.'
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function matchQuestion(
  field: DetectedField,
  qaBank: QAEntry[],
  profile: ParsedProfile,
  chain: FallbackChain,
  aiDrafting: boolean,
): Promise<MappingResult> {
  const blankResult = (note?: string): MappingResult => ({
    field, value: null, source: 'blank', confidence: 'low',
    needsReview: true, note, include: false,
  })

  // ── Step 1: Rule match ────────────────────────────────────────────────────

  const scored = qaBank
    .map(entry => ({ entry, score: scoreEntry(field.label, entry) }))
    .filter(x => x.score >= RULE_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  if (scored.length > 0) {
    return {
      field,
      value: scored[0].entry.answer,
      source: 'qa',
      confidence: 'high',
      needsReview: false,
      include: true,
    }
  }

  // ── Step 2: LLM semantic match ─────────────────────────────────────────────

  const top3 = qaBank
    .map(entry => ({ entry, score: scoreEntry(field.label, entry) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.entry)

  if (top3.length > 0) {
    try {
      const listText = top3.map((e, i) => `${i}: "${e.question}" → "${e.answer.slice(0, 100)}"`).join('\n')
      const res = await chain.complete({
        systemPrompt: 'You select the best-matching saved answer for a form question. Reply with ONLY a number (0, 1, or 2) or the word "none".',
        userPrompt: `Form question: "${field.label}"\n\nSaved answers:\n${listText}\n\nBest match (0/1/2/none):`,
        maxTokens: 5,
      })
      const choice = res.content.trim().replace(/[^0-9none]/g, '')
      const idx = parseInt(choice)
      if (!isNaN(idx) && idx >= 0 && idx < top3.length) {
        return {
          field,
          value: top3[idx].answer,
          source: 'qa',
          confidence: 'medium',
          needsReview: true,
          include: true,
        }
      }
    } catch {
      // Semantic match failed — fall through to draft
    }
  }

  // ── Step 3: AI draft ──────────────────────────────────────────────────────

  if (!aiDrafting) return blankResult()

  try {
    const profileContext = compactProfileForDrafting(profile)
    const res = await chain.complete({
      systemPrompt: 'You draft concise answers to job application questions using only the provided profile data. Never invent facts not present in the profile. If the question asks for a specific fact (e.g. exact years with a tool) that is not in the profile, respond exactly with: FACT_NOT_IN_PROFILE',
      userPrompt: `Profile:\n${profileContext}\n\nForm question: "${field.label}"\n\nAnswer (or FACT_NOT_IN_PROFILE if unknown):`,
      maxTokens: 200,
    })

    const answer = res.content.trim()
    if (answer === 'FACT_NOT_IN_PROFILE' || answer.includes('FACT_NOT_IN_PROFILE')) {
      return blankResult('fact-not-in-profile')
    }

    return {
      field,
      value: answer,
      source: 'llm',
      confidence: 'medium',
      needsReview: true,
      include: true,
    }
  } catch (err) {
    if (err instanceof FallbackExhaustedError) return blankResult()
    return blankResult()
  }
}
