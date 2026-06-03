import { describe, it, expect } from 'vitest'
import { parseQABank, qaEntryToMarkdown, appendQAEntry } from './qa-parser'

const BANK = `# Q&A Bank

## Are you legally authorized to work?
- type: boolean
- tags: work-authorization, eligibility
- answer: Yes

## What is your expected salary?
- type: text
- tags: salary, compensation
- answer: Negotiable / market rate

## Why do you want to work here?
- type: long-text
- tags: motivation
- answer: |
  I am passionate about the company's mission.
  And I have the skills to contribute.

## Years of experience with Python?
- type: number
- tags: skills, python
- answer: 5
`

describe('parseQABank', () => {
  it('parses all entries', () => {
    const entries = parseQABank(BANK)
    expect(entries).toHaveLength(4)
  })

  it('parses boolean entry correctly', () => {
    const entries = parseQABank(BANK)
    expect(entries[0].question).toBe('Are you legally authorized to work?')
    expect(entries[0].type).toBe('boolean')
    expect(entries[0].tags).toEqual(['work-authorization', 'eligibility'])
    expect(entries[0].answer).toBe('Yes')
  })

  it('parses text entry', () => {
    const entries = parseQABank(BANK)
    expect(entries[1].type).toBe('text')
    expect(entries[1].answer).toBe('Negotiable / market rate')
  })

  it('parses multi-line answer (YAML block scalar)', () => {
    const entries = parseQABank(BANK)
    expect(entries[2].type).toBe('long-text')
    expect(entries[2].answer).toContain("passionate about the company's mission")
    expect(entries[2].answer).toContain('contribute')
  })

  it('parses number entry', () => {
    const entries = parseQABank(BANK)
    expect(entries[3].type).toBe('number')
    expect(entries[3].answer).toBe('5')
  })

  it('skips malformed entries (missing answer) without throwing', () => {
    const malformed = `# Q&A Bank\n\n## No answer here\n- type: text\n- tags: foo\n`
    const entries = parseQABank(malformed)
    expect(entries).toHaveLength(0)
  })

  it('defaults unknown type to text', () => {
    const bank = `## Q?\n- type: invalid-type\n- tags: x\n- answer: yes\n`
    const entries = parseQABank(bank)
    expect(entries[0].type).toBe('text')
  })

  it('returns empty array for empty bank', () => {
    expect(parseQABank('')).toEqual([])
    expect(parseQABank('# Q&A Bank\n')).toEqual([])
  })
})

describe('qaEntryToMarkdown', () => {
  it('serialises single-line answer', () => {
    const md = qaEntryToMarkdown({ question: 'Q?', type: 'boolean', tags: ['a', 'b'], answer: 'Yes' })
    expect(md).toContain('## Q?')
    expect(md).toContain('- type: boolean')
    expect(md).toContain('- tags: a, b')
    expect(md).toContain('- answer: Yes')
  })

  it('serialises multi-line answer with block scalar', () => {
    const md = qaEntryToMarkdown({ question: 'Q?', type: 'long-text', tags: [], answer: 'Line 1\nLine 2' })
    expect(md).toContain('- answer: |')
    expect(md).toContain('  Line 1')
    expect(md).toContain('  Line 2')
  })
})

describe('appendQAEntry', () => {
  it('appends to existing bank without duplicating', () => {
    const newEntry = { question: 'New Q?', type: 'text' as const, tags: ['new'], answer: 'New answer' }
    const result = appendQAEntry(BANK, newEntry)
    const entries = parseQABank(result)
    expect(entries).toHaveLength(5)
    expect(entries[4].question).toBe('New Q?')
    // Original entries untouched
    expect(entries[0].question).toBe('Are you legally authorized to work?')
  })

  it('creates a header if bank is empty', () => {
    const result = appendQAEntry('', { question: 'Q?', type: 'text', tags: [], answer: 'A' })
    expect(result).toContain('# Q&A Bank')
    expect(result).toContain('## Q?')
  })

  it('does not double-append when called twice', () => {
    const entry = { question: 'Q?', type: 'text' as const, tags: [], answer: 'A' }
    const once = appendQAEntry(BANK, entry)
    const entries = parseQABank(once)
    // Should still be exactly 5 entries, not 6
    expect(entries).toHaveLength(5)
  })
})
