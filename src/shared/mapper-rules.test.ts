import { describe, it, expect } from 'vitest'
import { applyRules } from './mapper-rules'
import { parseProfile } from './profile-parser'
import type { DetectedField } from './types'

const PROFILE_MD = `---
profile_name: Test
updated: 2026-06-03
---

# Personal Information
- Full name: Jane Doe
- Email: jane@example.com
- Phone: +1-555-0100
- LinkedIn: https://linkedin.com/in/janedoe
- GitHub: https://github.com/janedoe
- City: Dubai
- Country: UAE

# Professional Summary
Experienced ML engineer.

# Work Experience
## Senior ML Engineer — Acme Corp
- Start: 2022-03
- End: present

# Education
## BSc Computer Science — Example University
- Start: 2015-09
- End: 2019-06
- Grade: 3.7/4.0
- Field of study: Computer Science

# Preferences
- Notice period: 1 month
- Salary expectation: Negotiable
- Willing to relocate: Yes
`

const profile = parseProfile(PROFILE_MD)

function f(label: string, extra: Partial<DetectedField> = {}): DetectedField {
  return { fieldId: `f_0_${label}`, label, type: 'text', required: false, ...extra }
}

describe('applyRules', () => {
  it('maps full name', () => {
    const results = applyRules([f('Full Name')], profile)
    expect(results[0].value).toBe('Jane Doe')
    expect(results[0].source).toBe('rule')
    expect(results[0].confidence).toBe('high')
  })

  it('maps email', () => {
    const results = applyRules([f('Email')], profile)
    expect(results[0].value).toBe('jane@example.com')
  })

  it('maps phone', () => {
    const results = applyRules([f('Phone')], profile)
    expect(results[0].value).toBe('+1-555-0100')
  })

  it('maps linkedin', () => {
    const results = applyRules([f('LinkedIn')], profile)
    expect(results[0].value).toBe('https://linkedin.com/in/janedoe')
  })

  it('maps city', () => {
    const results = applyRules([f('City')], profile)
    expect(results[0].value).toBe('Dubai')
  })

  it('maps country', () => {
    const results = applyRules([f('Country')], profile)
    expect(results[0].value).toBe('UAE')
  })

  it('maps current company', () => {
    const results = applyRules([f('Company')], profile)
    expect(results[0].value).toBe('Acme Corp')
  })

  it('maps current job title', () => {
    const results = applyRules([f('Job Title')], profile)
    expect(results[0].value).toBe('Senior ML Engineer')
  })

  it('maps degree', () => {
    const results = applyRules([f('Degree')], profile)
    expect(results[0].value).toBe('BSc Computer Science')
  })

  it('maps institution', () => {
    const results = applyRules([f('University')], profile)
    expect(results[0].value).toBe('Example University')
  })

  it('maps notice period preference', () => {
    const results = applyRules([f('Notice Period')], profile)
    expect(results[0].value).toBe('1 month')
  })

  it('maps salary preference', () => {
    const results = applyRules([f('Expected Salary')], profile)
    expect(results[0].value).toBe('Negotiable')
  })

  it('maps via autocomplete token', () => {
    const field = f('', { autocomplete: 'email', label: '' })
    const results = applyRules([field], profile)
    expect(results[0].value).toBe('jane@example.com')
  })

  it('unmatched field returns blank with low confidence', () => {
    const results = applyRules([f('Some Unknown Custom Field')], profile)
    expect(results[0].source).toBe('blank')
    expect(results[0].confidence).toBe('low')
    expect(results[0].value).toBeNull()
    expect(results[0].include).toBe(false)
  })

  it('upload field is always blank+flagged', () => {
    const uploadField = f('Resume', { type: 'file', isUpload: true, uploadKind: 'resume' })
    const results = applyRules([uploadField], profile)
    expect(results[0].source).toBe('blank')
    expect(results[0].note).toBe('upload-field')
    expect(results[0].include).toBe(false)
  })

  it('processes multiple fields in one call', () => {
    const fields = [f('Full Name'), f('Email'), f('Phone')]
    const results = applyRules(fields, profile)
    expect(results).toHaveLength(3)
    expect(results.map(r => r.value)).toEqual(['Jane Doe', 'jane@example.com', '+1-555-0100'])
  })
})
