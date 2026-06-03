import type {
  ParsedProfile, ProfileFrontmatter,
  WorkEntry, EducationEntry, CertificationEntry, ProjectEntry,
} from './types'

// ─── YAML frontmatter parser (hand-rolled for the subset we use) ─────────────

function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m)
  if (!match) return { fm: {}, body: raw }
  const fm: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
    if (key) fm[key] = val
  }
  return { fm, body: match[2] ?? '' }
}

// ─── Section splitter ─────────────────────────────────────────────────────────

interface Section { heading: string; content: string }

function splitSections(body: string): Section[] {
  const lines = body.split('\n')
  const sections: Section[] = []
  let current: Section | null = null
  for (const line of lines) {
    if (/^# /.test(line)) {
      if (current) sections.push(current)
      current = { heading: line.replace(/^# /, '').trim(), content: '' }
    } else if (current) {
      current.content += line + '\n'
    }
  }
  if (current) sections.push(current)
  return sections
}

// ─── Bullet list parser ───────────────────────────────────────────────────────

function parseBulletList(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^-\s+([^:]+):\s*(.*)$/)
    if (m) result[m[1].trim()] = m[2].trim()
  }
  return result
}

// ─── Sub-section splitter (## headings) ──────────────────────────────────────

interface SubSection { heading: string; content: string }

function splitSubSections(text: string): SubSection[] {
  const lines = text.split('\n')
  const subs: SubSection[] = []
  let cur: SubSection | null = null
  for (const line of lines) {
    if (/^## /.test(line)) {
      if (cur) subs.push(cur)
      cur = { heading: line.replace(/^## /, '').trim(), content: '' }
    } else if (cur) {
      cur.content += line + '\n'
    }
  }
  if (cur) subs.push(cur)
  return subs
}

// ─── Section parsers ──────────────────────────────────────────────────────────

function parsePersonal(text: string): Record<string, string> {
  return parseBulletList(text)
}

function parseWorkExperience(text: string): WorkEntry[] {
  return splitSubSections(text).map(sub => {
    const parts = sub.heading.split(' — ')
    const title = parts[0]?.trim() ?? sub.heading
    const company = parts[1]?.trim() ?? ''
    const fields = parseBulletList(sub.content)
    const highlights: string[] = []
    let inHighlights = false
    for (const line of sub.content.split('\n')) {
      if (/highlights:/i.test(line)) { inHighlights = true; continue }
      if (inHighlights && /^\s{2,}-\s+/.test(line)) {
        highlights.push(line.replace(/^\s+-\s+/, '').trim())
      } else if (inHighlights && /^-\s+\w/.test(line) && !/highlights:/i.test(line)) {
        inHighlights = false
      }
    }
    return {
      title,
      company,
      location: fields['Location'],
      start: fields['Start'] ?? '',
      end: fields['End'] ?? '',
      employmentType: fields['Employment type'] ?? fields['Employment Type'],
      highlights,
    }
  })
}

function parseEducation(text: string): EducationEntry[] {
  return splitSubSections(text).map(sub => {
    const parts = sub.heading.split(' — ')
    const degree = parts[0]?.trim() ?? sub.heading
    const institution = parts[1]?.trim() ?? ''
    const fields = parseBulletList(sub.content)
    return {
      degree,
      institution,
      fieldOfStudy: fields['Field of study'] ?? fields['Field of Study'],
      start: fields['Start'] ?? '',
      end: fields['End'] ?? '',
      grade: fields['Grade'] ?? fields['GPA'],
    }
  })
}

function parseCertifications(text: string): CertificationEntry[] {
  return splitSubSections(text).map(sub => {
    const fields = parseBulletList(sub.content)
    return {
      name: sub.heading,
      issuer: fields['Issuer'],
      issued: fields['Issued'],
      expires: fields['Expires'],
      credentialId: fields['Credential ID'] ?? fields['Credential id'],
      url: fields['URL'] ?? fields['Url'],
    }
  })
}

function parseSkills(text: string): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^-\s+([^:]+):\s*(.*)$/)
    if (m) {
      result[m[1].trim()] = m[2].split(',').map(s => s.trim()).filter(Boolean)
    }
  }
  return result
}

function parseLanguages(text: string): Record<string, string> {
  return parseBulletList(text)
}

function parseProjects(text: string): ProjectEntry[] {
  return splitSubSections(text).map(sub => {
    const fields = parseBulletList(sub.content)
    return { name: sub.heading, url: fields['URL'] ?? fields['Url'], summary: fields['Summary'] }
  })
}

function parsePreferences(text: string): Record<string, string> {
  return parseBulletList(text)
}

// ─── Known section heading → parser mapping ───────────────────────────────────

const KNOWN_SECTIONS = new Set([
  'personal information',
  'professional summary',
  'work experience',
  'education',
  'certifications',
  'skills',
  'languages',
  'projects',
  'preferences',
])

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseProfile(markdown: string): ParsedProfile {
  const { fm, body } = parseFrontmatter(markdown)
  const frontmatter: ProfileFrontmatter = {
    profile_name: fm['profile_name'] ?? 'Unnamed Profile',
    target_role: fm['target_role'],
    updated: fm['updated'] ?? '',
  }

  const personal: Record<string, string> = {}
  let summary: string | undefined
  let experience: WorkEntry[] = []
  let education: EducationEntry[] = []
  let certifications: CertificationEntry[] = []
  let skills: Record<string, string[]> = {}
  let languages: Record<string, string> = {}
  let projects: ProjectEntry[] = []
  let preferences: Record<string, string> = {}
  const unknownSections: Record<string, string> = {}

  for (const { heading, content } of splitSections(body)) {
    const key = heading.toLowerCase()
    if (key === 'personal information') {
      Object.assign(personal, parsePersonal(content))
    } else if (key === 'professional summary') {
      summary = content.trim()
    } else if (key === 'work experience') {
      experience = parseWorkExperience(content)
    } else if (key === 'education') {
      education = parseEducation(content)
    } else if (key === 'certifications') {
      certifications = parseCertifications(content)
    } else if (key === 'skills') {
      skills = parseSkills(content)
    } else if (key === 'languages') {
      languages = parseLanguages(content)
    } else if (key === 'projects') {
      projects = parseProjects(content)
    } else if (key === 'preferences') {
      preferences = parsePreferences(content)
    } else if (!KNOWN_SECTIONS.has(key)) {
      unknownSections[heading] = content
    }
  }

  return {
    frontmatter, personal, summary,
    experience, education, certifications,
    skills, languages, projects, preferences,
    unknownSections,
    raw: markdown,
  }
}

export function validateProfile(profile: ParsedProfile): string[] {
  const warnings: string[] = []
  if (!profile.frontmatter.profile_name) warnings.push('Missing profile_name in frontmatter.')
  if (!profile.personal['Full name'] && !profile.personal['full name']) warnings.push('Missing Full name in Personal Information.')
  if (!profile.personal['Email'] && !profile.personal['email']) warnings.push('Missing Email in Personal Information.')
  for (const exp of profile.experience) {
    if (!exp.start) warnings.push(`Work entry "${exp.title}" missing Start date.`)
    if (!exp.end) warnings.push(`Work entry "${exp.title}" missing End date.`)
  }
  return warnings
}

export function profileToMarkdown(profile: ParsedProfile): string {
  const { frontmatter: fm, personal, summary, experience, education,
    certifications, skills, languages, projects, preferences, unknownSections } = profile

  const lines: string[] = [
    '---',
    `profile_name: ${fm.profile_name}`,
    ...(fm.target_role ? [`target_role: ${fm.target_role}`] : []),
    `updated: ${fm.updated}`,
    '---',
    '',
  ]

  if (Object.keys(personal).length) {
    lines.push('# Personal Information')
    for (const [k, v] of Object.entries(personal)) lines.push(`- ${k}: ${v}`)
    lines.push('')
  }

  if (summary) {
    lines.push('# Professional Summary')
    lines.push(summary)
    lines.push('')
  }

  if (experience.length) {
    lines.push('# Work Experience')
    for (const e of experience) {
      lines.push(`## ${e.title} — ${e.company}`)
      if (e.location) lines.push(`- Location: ${e.location}`)
      lines.push(`- Start: ${e.start}`)
      lines.push(`- End: ${e.end}`)
      if (e.employmentType) lines.push(`- Employment type: ${e.employmentType}`)
      if (e.highlights.length) {
        lines.push('- Highlights:')
        for (const h of e.highlights) lines.push(`  - ${h}`)
      }
      lines.push('')
    }
  }

  if (education.length) {
    lines.push('# Education')
    for (const e of education) {
      lines.push(`## ${e.degree} — ${e.institution}`)
      if (e.start) lines.push(`- Start: ${e.start}`)
      if (e.end) lines.push(`- End: ${e.end}`)
      if (e.grade) lines.push(`- Grade: ${e.grade}`)
      if (e.fieldOfStudy) lines.push(`- Field of study: ${e.fieldOfStudy}`)
      lines.push('')
    }
  }

  if (certifications.length) {
    lines.push('# Certifications')
    for (const c of certifications) {
      lines.push(`## ${c.name}`)
      if (c.issuer) lines.push(`- Issuer: ${c.issuer}`)
      if (c.issued) lines.push(`- Issued: ${c.issued}`)
      if (c.expires) lines.push(`- Expires: ${c.expires}`)
      if (c.credentialId) lines.push(`- Credential ID: ${c.credentialId}`)
      if (c.url) lines.push(`- URL: ${c.url}`)
      lines.push('')
    }
  }

  if (Object.keys(skills).length) {
    lines.push('# Skills')
    for (const [k, v] of Object.entries(skills)) lines.push(`- ${k}: ${v.join(', ')}`)
    lines.push('')
  }

  if (Object.keys(languages).length) {
    lines.push('# Languages')
    for (const [k, v] of Object.entries(languages)) lines.push(`- ${k}: ${v}`)
    lines.push('')
  }

  if (projects.length) {
    lines.push('# Projects')
    for (const p of projects) {
      lines.push(`## ${p.name}`)
      if (p.url) lines.push(`- URL: ${p.url}`)
      if (p.summary) lines.push(`- Summary: ${p.summary}`)
      lines.push('')
    }
  }

  if (Object.keys(preferences).length) {
    lines.push('# Preferences')
    for (const [k, v] of Object.entries(preferences)) lines.push(`- ${k}: ${v}`)
    lines.push('')
  }

  for (const [heading, content] of Object.entries(unknownSections)) {
    lines.push(`# ${heading}`)
    lines.push(content.trimEnd())
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}
