import { describe, it, expect, vi } from 'vitest'
import { matchQuestion } from './qa-matcher'
import { parseProfile } from '@shared/profile-parser'
import { appendQAEntry } from '@shared/qa-parser'
import type { DetectedField, QAEntry } from '@shared/types'
import type { FallbackChain } from './llm/fallback'
import { FallbackExhaustedError } from './llm/provider'

const PROFILE_MD = `---
profile_name: Test
updated: 2026-06-03
---

# Personal Information
- Full name: Jane Doe
- Email: jane@example.com

# Preferences
- Notice period: 1 month
- Salary expectation: Negotiable
- Willing to relocate: Yes
`
const profile = parseProfile(PROFILE_MD)

const BANK: QAEntry[] = [
  { question: 'Are you legally authorized to work?', type: 'boolean', tags: ['work-authorization', 'eligibility'], answer: 'Yes' },
  { question: 'What is your expected salary?', type: 'text', tags: ['salary', 'compensation'], answer: 'Negotiable' },
  { question: 'What is your notice period?', type: 'text', tags: ['notice', 'availability'], answer: '1 month' },
]

function field(label: string): DetectedField {
  return { fieldId: 'f_0', label, type: 'text', required: false }
}

function mockChain(response: string): FallbackChain {
  return { complete: vi.fn().mockResolvedValue({ content: response, providerId: 'openai' }) } as unknown as FallbackChain
}

describe('matchQuestion', () => {
  it('rule match on exact tag: salary', async () => {
    const chain = mockChain('1') // should not be called
    const result = await matchQuestion(field('expected salary'), BANK, profile, chain, false)
    expect(result.source).toBe('qa')
    expect(result.confidence).toBe('high')
    expect(result.value).toBe('Negotiable')
    expect(chain.complete).not.toHaveBeenCalled()
  })

  it('rule match on partial label: notice period', async () => {
    const chain = mockChain('0')
    const result = await matchQuestion(field('Notice Period'), BANK, profile, chain, false)
    expect(result.source).toBe('qa')
    expect(result.value).toBe('1 month')
  })

  it('rule match on work authorization tag', async () => {
    const chain = mockChain('none')
    const result = await matchQuestion(field('work authorization'), BANK, profile, chain, false)
    expect(result.source).toBe('qa')
    expect(result.value).toBe('Yes')
  })

  it('LLM semantic match when no rule match (returns index)', async () => {
    // Use a label that has NO tag overlap with the bank entries
    const chain = {
      complete: vi.fn().mockResolvedValue({ content: '2', providerId: 'openai' }),
    } as unknown as FallbackChain
    // Pass an empty bank so rule scoring is zero; LLM semantic runs with top-3 from bank
    const result = await matchQuestion(field('Xylophone preference inquiry'), BANK, profile, chain, false)
    expect(result.source).toBe('qa')
    expect(result.confidence).toBe('medium')
  })

  it('AI draft when no bank match and aiDrafting enabled', async () => {
    // Empty bank → Step 2 (semantic) is skipped → only one LLM call for draft
    const chain = {
      complete: vi.fn().mockResolvedValue({ content: 'I am passionate about ML and the mission here.', providerId: 'openai' }),
    } as unknown as FallbackChain
    const result = await matchQuestion(field('Why do you want to work here?'), [], profile, chain, true)
    expect(result.source).toBe('llm')
    expect(result.confidence).toBe('medium')
    expect(result.needsReview).toBe(true)
    expect(result.value).toContain('ML')
  })

  it('returns blank when aiDrafting disabled and no bank match', async () => {
    const chain = mockChain('none')
    const result = await matchQuestion(field('Completely unknown question xyz'), [], profile, chain, false)
    expect(result.source).toBe('blank')
    expect(result.value).toBeNull()
  })

  it('returns fact-not-in-profile note when LLM signals missing fact', async () => {
    // Empty bank → no semantic step, only draft call
    const chain = {
      complete: vi.fn().mockResolvedValue({ content: 'FACT_NOT_IN_PROFILE', providerId: 'openai' }),
    } as unknown as FallbackChain
    const result = await matchQuestion(field('How many years have you used PyTorch specifically?'), [], profile, chain, true)
    expect(result.source).toBe('blank')
    expect(result.note).toBe('fact-not-in-profile')
  })

  it('returns blank when FallbackExhaustedError during draft', async () => {
    // Empty bank → no semantic step, only draft call which throws
    const chain = {
      complete: vi.fn().mockRejectedValue(new FallbackExhaustedError([])),
    } as unknown as FallbackChain
    const result = await matchQuestion(field('Open-ended custom question?'), [], profile, chain, true)
    expect(result.source).toBe('blank')
  })

  it('save-back via appendQAEntry appends without overwriting', () => {
    const existingBank = BANK.map(e =>
      `## ${e.question}\n- type: ${e.type}\n- tags: ${e.tags.join(', ')}\n- answer: ${e.answer}`
    ).join('\n\n')
    const newEntry: QAEntry = { question: 'New Q?', type: 'text', tags: ['new'], answer: 'New answer' }
    const updated = appendQAEntry(existingBank, newEntry)
    expect(updated).toContain('New Q?')
    expect(updated).toContain('Are you legally authorized') // original preserved
  })
})
