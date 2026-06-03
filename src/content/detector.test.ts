import { describe, it, expect, beforeEach } from 'vitest'
import { detectFields, resolveLabel, getFieldElement } from './detector'

function setDocument(html: string) {
  document.body.innerHTML = html
}

describe('detectFields', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('detects text input', () => {
    setDocument('<input type="text" id="name" />')
    const fields = detectFields()
    expect(fields.length).toBeGreaterThan(0)
    expect(fields[0].type).toBe('text')
  })

  it('detects email input', () => {
    setDocument('<input type="email" id="email" />')
    const fields = detectFields()
    expect(fields[0].type).toBe('email')
  })

  it('detects textarea', () => {
    setDocument('<textarea id="bio"></textarea>')
    const fields = detectFields()
    expect(fields[0].type).toBe('textarea')
  })

  it('detects select', () => {
    setDocument('<select id="country"><option>UAE</option><option>UK</option></select>')
    const fields = detectFields()
    expect(fields[0].type).toBe('select')
    expect(fields[0].options).toEqual(['UAE', 'UK'])
  })

  it('detects file upload and classifies as resume', () => {
    setDocument('<label>Upload Resume <input type="file" /></label>')
    const fields = detectFields()
    expect(fields[0].type).toBe('file')
    expect(fields[0].isUpload).toBe(true)
    expect(fields[0].uploadKind).toBe('resume')
  })

  it('detects file upload and classifies as cover-letter', () => {
    setDocument('<label>Cover Letter <input type="file" /></label>')
    const fields = detectFields()
    expect(fields[0].uploadKind).toBe('cover-letter')
  })

  it('skips disabled inputs', () => {
    setDocument('<input type="text" disabled />')
    expect(detectFields()).toHaveLength(0)
  })

  it('skips hidden inputs', () => {
    setDocument('<input type="hidden" value="secret" />')
    expect(detectFields()).toHaveLength(0)
  })

  it('skips aria-hidden honeypots', () => {
    setDocument('<input type="text" aria-hidden="true" />')
    expect(detectFields()).toHaveLength(0)
  })

  it('generates stable fieldIds', () => {
    setDocument('<label>Email <input type="email" /></label>')
    const a = detectFields()
    const b = detectFields()
    expect(a[0].fieldId).toBe(b[0].fieldId)
  })

  it('populates fieldMap so getFieldElement works', () => {
    setDocument('<input type="text" id="fn" />')
    const fields = detectFields()
    const el = getFieldElement(fields[0].fieldId)
    expect(el).toBeInstanceOf(HTMLInputElement)
  })

  it('detects required flag', () => {
    setDocument('<input type="text" required />')
    const fields = detectFields()
    expect(fields[0].required).toBe(true)
  })

  it('captures maxLength', () => {
    setDocument('<input type="text" maxlength="100" />')
    const fields = detectFields()
    expect(fields[0].maxLength).toBe(100)
  })

  it('captures name and id attributes', () => {
    setDocument('<input type="text" id="first_name" name="firstName" />')
    const fields = detectFields()
    expect(fields[0].id).toBe('first_name')
    expect(fields[0].name).toBe('firstName')
  })
})

describe('resolveLabel', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('resolves via <label for>', () => {
    document.body.innerHTML = '<label for="fn">Full Name</label><input id="fn" />'
    const input = document.querySelector('input')!
    expect(resolveLabel(input)).toBe('Full Name')
  })

  it('resolves via wrapping <label>', () => {
    document.body.innerHTML = '<label>Email <input type="email" /></label>'
    const input = document.querySelector('input')!
    expect(resolveLabel(input)).toContain('Email')
  })

  it('resolves via aria-label', () => {
    document.body.innerHTML = '<input aria-label="Phone Number" />'
    const input = document.querySelector('input')!
    expect(resolveLabel(input)).toBe('Phone Number')
  })

  it('resolves via placeholder as fallback', () => {
    document.body.innerHTML = '<input placeholder="Enter city" />'
    const input = document.querySelector('input')!
    expect(resolveLabel(input)).toBe('Enter city')
  })

  it('de-camelCases name as last resort', () => {
    document.body.innerHTML = '<input name="firstName" />'
    const input = document.querySelector('input')!
    expect(resolveLabel(input)).toMatch(/first\s*name/i)
  })
})
