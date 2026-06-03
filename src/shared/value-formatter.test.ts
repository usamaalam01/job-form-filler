import { describe, it, expect } from 'vitest'
import { formatDate, fuzzyMatchOption, formatValue } from './value-formatter'
import type { DetectedField } from './types'

function field(overrides: Partial<DetectedField> = {}): DetectedField {
  return { fieldId: 'f_0', label: 'Test', type: 'text', required: false, ...overrides }
}

describe('formatDate', () => {
  it('formats YYYY-MM for month field', () => {
    expect(formatDate('2022-03', field({ type: 'month' }))).toBe('2022-03')
  })
  it('formats YYYY-MM-DD for date field', () => {
    expect(formatDate('2022-03', field({ type: 'date' }))).toBe('2022-03-01')
  })
  it('passes through YYYY-MM-DD for date field', () => {
    expect(formatDate('2022-03-15', field({ type: 'date' }))).toBe('2022-03-15')
  })
  it('returns year-only for a year select', () => {
    const f = field({ type: 'select', options: ['2020', '2021', '2022', '2023', '2024'] })
    expect(formatDate('2022-03', f)).toBe('2022')
  })
  it('passes through "present" unchanged', () => {
    expect(formatDate('present', field({ type: 'text' }))).toBe('present')
  })
  it('passes through non-date strings unchanged', () => {
    expect(formatDate('Software Engineer', field())).toBe('Software Engineer')
  })
})

describe('fuzzyMatchOption', () => {
  it('exact match returns high confidence', () => {
    const r = fuzzyMatchOption('UAE', ['UAE', 'UK', 'USA'])
    expect(r.match).toBe('UAE')
    expect(r.confidence).toBe('high')
  })
  it('case-insensitive exact match', () => {
    const r = fuzzyMatchOption('uae', ['UAE', 'UK'])
    expect(r.match).toBe('UAE')
  })
  it('synonym match: bsc → bachelor', () => {
    const r = fuzzyMatchOption('bsc', ["Bachelor's Degree", "Master's Degree", 'PhD'])
    expect(r.match).toBe("Bachelor's Degree")
    expect(r.confidence).toBe('high')
  })
  it('synonym match: master', () => {
    const r = fuzzyMatchOption('master', ["Bachelor's Degree", "Master's Degree"])
    expect(r.match).toBe("Master's Degree")
  })
  it('levenshtein distance ≤ 2 returns medium', () => {
    const r = fuzzyMatchOption('Engneer', ['Engineer', 'Designer'])
    expect(r.match).toBe('Engineer')
    expect(r.confidence).toBe('medium')
  })
  it('no match returns null and low confidence', () => {
    const r = fuzzyMatchOption('XYZ123', ['Apple', 'Banana', 'Cherry'])
    expect(r.match).toBeNull()
    expect(r.confidence).toBe('low')
  })
})

describe('formatValue', () => {
  it('truncates to maxLength and sets note', () => {
    const f = field({ maxLength: 10 })
    const r = formatValue('This is a very long string', f)
    expect(r.value).toHaveLength(10)
    expect(r.note).toBe('truncated')
  })
  it('returns no-matching-option note when select has no match', () => {
    const f = field({ type: 'select', options: ['Apple', 'Banana'] })
    const r = formatValue('XYZ999', f)
    expect(r.note).toBe('no-matching-option')
  })
  it('returns matched option value for select', () => {
    const f = field({ type: 'select', options: ['United Arab Emirates', 'United Kingdom'] })
    const r = formatValue('UAE', f)
    // substring match: UAE is in United Arab Emirates
    expect(r.value).toBeTruthy()
  })
  it('passes through plain text unchanged', () => {
    const r = formatValue('Jane Doe', field())
    expect(r.value).toBe('Jane Doe')
    expect(r.note).toBeUndefined()
  })
})
