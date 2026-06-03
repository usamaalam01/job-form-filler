import { describe, it, expect } from 'vitest'
import { parseProfile, validateProfile, profileToMarkdown } from './profile-parser'

const FULL_PROFILE = `---
profile_name: ML Engineer
target_role: Machine Learning Engineer
updated: 2026-06-03
---

# Personal Information
- Full name: Jane Doe
- Email: jane@example.com
- Phone: +1-555-0100
- LinkedIn: https://linkedin.com/in/janedoe
- GitHub: https://github.com/janedoe

# Professional Summary
An experienced ML engineer.

# Work Experience
## Senior ML Engineer — Acme Corp
- Location: Dubai, UAE
- Start: 2022-03
- End: present
- Employment type: Full-time
- Highlights:
  - Built X, improving Y by 30%.
  - Led team of 5.

## ML Engineer — Beta Inc
- Start: 2019-07
- End: 2022-02
- Highlights:
  - Did A and B.

# Education
## BSc Computer Science — Example University
- Start: 2015-09
- End: 2019-06
- Grade: 3.7/4.0
- Field of study: Computer Science

# Certifications
## AWS Certified ML – Specialty
- Issuer: Amazon Web Services
- Issued: 2023-05
- Expires: 2026-05
- Credential ID: ABC123
- URL: https://aws.amazon.com/verify/ABC123

# Skills
- Languages: Python, SQL, TypeScript
- ML: PyTorch, scikit-learn
- Cloud: AWS, GCP

# Languages
- English: Professional
- Urdu: Native

# Projects
## Cool Project
- URL: https://github.com/janedoe/cool
- Summary: A cool thing.

# Preferences
- Work authorization: Yes
- Notice period: 1 month
- Willing to relocate: Yes

# Custom Section
Some custom content here.
`

describe('parseProfile', () => {
  it('parses frontmatter correctly', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.frontmatter.profile_name).toBe('ML Engineer')
    expect(p.frontmatter.target_role).toBe('Machine Learning Engineer')
    expect(p.frontmatter.updated).toBe('2026-06-03')
  })

  it('parses personal information', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.personal['Full name']).toBe('Jane Doe')
    expect(p.personal['Email']).toBe('jane@example.com')
    expect(p.personal['LinkedIn']).toBe('https://linkedin.com/in/janedoe')
  })

  it('parses professional summary', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.summary).toBe('An experienced ML engineer.')
  })

  it('parses work experience entries', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.experience).toHaveLength(2)
    expect(p.experience[0].title).toBe('Senior ML Engineer')
    expect(p.experience[0].company).toBe('Acme Corp')
    expect(p.experience[0].start).toBe('2022-03')
    expect(p.experience[0].end).toBe('present')
    expect(p.experience[0].highlights).toHaveLength(2)
    expect(p.experience[1].title).toBe('ML Engineer')
  })

  it('parses education entries', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.education).toHaveLength(1)
    expect(p.education[0].degree).toBe('BSc Computer Science')
    expect(p.education[0].institution).toBe('Example University')
    expect(p.education[0].grade).toBe('3.7/4.0')
    expect(p.education[0].fieldOfStudy).toBe('Computer Science')
  })

  it('parses certifications', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.certifications).toHaveLength(1)
    expect(p.certifications[0].name).toBe('AWS Certified ML – Specialty')
    expect(p.certifications[0].issuer).toBe('Amazon Web Services')
    expect(p.certifications[0].credentialId).toBe('ABC123')
  })

  it('parses skills into arrays', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.skills['Languages']).toEqual(['Python', 'SQL', 'TypeScript'])
    expect(p.skills['ML']).toEqual(['PyTorch', 'scikit-learn'])
  })

  it('parses languages', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.languages['English']).toBe('Professional')
    expect(p.languages['Urdu']).toBe('Native')
  })

  it('parses projects', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.projects[0].name).toBe('Cool Project')
    expect(p.projects[0].url).toBe('https://github.com/janedoe/cool')
  })

  it('parses preferences', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.preferences['Notice period']).toBe('1 month')
  })

  it('preserves unknown sections verbatim', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.unknownSections['Custom Section']).toContain('Some custom content here.')
  })

  it('returns empty arrays/objects for missing sections', () => {
    const minimal = `---\nprofile_name: Minimal\nupdated: 2026-01-01\n---\n`
    const p = parseProfile(minimal)
    expect(p.experience).toEqual([])
    expect(p.education).toEqual([])
    expect(p.certifications).toEqual([])
    expect(p.skills).toEqual({})
    expect(p.preferences).toEqual({})
  })

  it('handles missing frontmatter leniently (no throw)', () => {
    const p = parseProfile('# Personal Information\n- Full name: Jane\n')
    expect(p.frontmatter.profile_name).toBe('Unnamed Profile')
    expect(p.personal['Full name']).toBe('Jane')
  })

  it('stores raw markdown', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(p.raw).toBe(FULL_PROFILE)
  })
})

describe('validateProfile', () => {
  it('returns no warnings for a complete profile', () => {
    const p = parseProfile(FULL_PROFILE)
    expect(validateProfile(p)).toHaveLength(0)
  })

  it('warns when email is missing', () => {
    const p = parseProfile(FULL_PROFILE)
    p.personal = {}
    const warnings = validateProfile(p)
    expect(warnings.some(w => w.includes('Email'))).toBe(true)
  })

  it('warns when work entry is missing start date', () => {
    const p = parseProfile(FULL_PROFILE)
    p.experience[0].start = ''
    const warnings = validateProfile(p)
    expect(warnings.some(w => w.includes('Start date'))).toBe(true)
  })
})

describe('profileToMarkdown (round-trip)', () => {
  it('round-trips a parsed profile stably', () => {
    const p = parseProfile(FULL_PROFILE)
    const md = profileToMarkdown(p)
    const p2 = parseProfile(md)
    expect(p2.frontmatter.profile_name).toBe(p.frontmatter.profile_name)
    expect(p2.personal['Full name']).toBe(p.personal['Full name'])
    expect(p2.experience[0].title).toBe(p.experience[0].title)
    expect(p2.education[0].degree).toBe(p.education[0].degree)
    expect(p2.skills['Languages']).toEqual(p.skills['Languages'])
    expect(p2.unknownSections['Custom Section']).toContain('Some custom content')
  })
})
