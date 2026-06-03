import { describe, it, expect, vi } from 'vitest'
import { mapFieldsWithLLM } from './mapper-llm'
import { parseProfile } from '@shared/profile-parser'
import type { DetectedField, QAEntry, LLMRequest } from '@shared/types'
import type { FallbackChain } from './llm/fallback'
import { FallbackExhaustedError } from './llm/provider'

const PROFILE_MD = `---
profile_name: Test
updated: 2026-06-03
---

# Personal Information
- Full name: Jane Doe
- Email: jane@example.com

# Work Experience
## Senior ML Engineer — Acme Corp
- Start: 2022-03
- End: present

# Preferences
- Notice period: 1 month
`
const profile = parseProfile(PROFILE_MD)
const qaBank: QAEntry[] = []

function field(fieldId: string, label: string): DetectedField {
  return { fieldId, label, type: 'text', required: false }
}

function mockChain(content: string): FallbackChain {
  return {
    complete: vi.fn().mockResolvedValue({ content, providerId: 'openai' }),
  } as unknown as FallbackChain
}

function validResponse(fieldId: string, value: string) {
  return JSON.stringify({ results: [{ fieldId, value, source: 'profile', confidence: 'high', note: null }] })
}

describe('mapFieldsWithLLM', () => {
  it('returns mapped result from valid LLM response', async () => {
    const f = field('f_0_notice', 'Notice Period')
    const chain = mockChain(validResponse('f_0_notice', '1 month'))
    const results = await mapFieldsWithLLM([f], profile, qaBank, chain, 30)
    expect(results[0].value).toBe('1 month')
    expect(results[0].source).toBe('profile')
    expect(results[0].confidence).toBe('high')
  })

  it('returns blank for unknown fields', async () => {
    const f = field('f_0_custom', 'Favourite colour')
    const chain = mockChain(JSON.stringify({ results: [{ fieldId: 'f_0_custom', value: null, source: 'blank', confidence: 'low', note: null }] }))
    const results = await mapFieldsWithLLM([f], profile, qaBank, chain, 30)
    expect(results[0].value).toBeNull()
    expect(results[0].source).toBe('blank')
  })

  it('repairs malformed JSON on first try', async () => {
    const f = field('f_0_name', 'Full Name')
    let callCount = 0
    const chain = {
      complete: vi.fn().mockImplementation((_req: LLMRequest) => {
        callCount++
        if (callCount === 1) return Promise.resolve({ content: 'not json at all', providerId: 'openai' })
        return Promise.resolve({ content: validResponse('f_0_name', 'Jane Doe'), providerId: 'openai' })
      }),
    } as unknown as FallbackChain
    const results = await mapFieldsWithLLM([f], profile, qaBank, chain, 30)
    expect(callCount).toBe(2) // initial + repair
    expect(results[0].value).toBe('Jane Doe')
  })

  it('returns blank+flag when both attempts fail', async () => {
    const f = field('f_0_x', 'Something')
    const chain = {
      complete: vi.fn().mockResolvedValue({ content: 'definitely not json', providerId: 'openai' }),
    } as unknown as FallbackChain
    const results = await mapFieldsWithLLM([f], profile, qaBank, chain, 30)
    expect(results[0].value).toBeNull()
    expect(results[0].note).toBe('llm-parse-failed')
  })

  it('batches fields into groups of batchSize', async () => {
    const fields = Array.from({ length: 5 }, (_, i) => field(`f_${i}_field${i}`, `Field ${i}`))
    const chain = {
      complete: vi.fn().mockImplementation((req: LLMRequest) => {
        // Extract fieldIds from the JSON array in the prompt
        const match = req.userPrompt.match(/\[\s*\{[\s\S]*?\}\s*\]/)
        const body: Array<{ fieldId: string }> = match ? JSON.parse(match[0]) : []
        const results = body.map(f => ({
          fieldId: f.fieldId, value: null, source: 'blank', confidence: 'low', note: null,
        }))
        return Promise.resolve({ content: JSON.stringify({ results }), providerId: 'openai' })
      }),
    } as unknown as FallbackChain
    await mapFieldsWithLLM(fields, profile, qaBank, chain, 2) // batchSize = 2 → 3 batches
    expect(chain.complete).toHaveBeenCalledTimes(3)
  })

  it('handles FallbackExhaustedError by returning blank for all in batch', async () => {
    const f = field('f_0_y', 'Some Field')
    const chain = {
      complete: vi.fn().mockRejectedValue(new FallbackExhaustedError([])),
    } as unknown as FallbackChain
    const results = await mapFieldsWithLLM([f], profile, qaBank, chain, 30)
    expect(results[0].value).toBeNull()
    expect(results[0].note).toBe('llm-parse-failed')
  })

  it('context compaction includes work experience for job-related fields', async () => {
    const f = field('f_0_company', 'Current Company')
    let capturedPrompt = ''
    const chain = {
      complete: vi.fn().mockImplementation((req: LLMRequest) => {
        capturedPrompt = req.userPrompt
        return Promise.resolve({ content: validResponse('f_0_company', 'Acme Corp'), providerId: 'openai' })
      }),
    } as unknown as FallbackChain
    await mapFieldsWithLLM([f], profile, qaBank, chain, 30)
    expect(capturedPrompt).toContain('Work Experience')
    expect(capturedPrompt).not.toContain('Certifications')
  })

  it('returns empty array when no unresolved fields', async () => {
    const chain = { complete: vi.fn() } as unknown as FallbackChain
    const results = await mapFieldsWithLLM([], profile, qaBank, chain, 30)
    expect(results).toHaveLength(0)
    expect(chain.complete).not.toHaveBeenCalled()
  })

  it('strips markdown code fences from LLM response', async () => {
    const f = field('f_0_email', 'Email')
    const fencedJson = '```json\n' + validResponse('f_0_email', 'jane@example.com') + '\n```'
    const chain = mockChain(fencedJson)
    const results = await mapFieldsWithLLM([f], profile, qaBank, chain, 30)
    expect(results[0].value).toBe('jane@example.com')
  })
})
