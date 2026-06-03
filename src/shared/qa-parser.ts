import type { QAEntry, QAType } from './types'

const VALID_TYPES = new Set<QAType>(['text', 'long-text', 'boolean', 'number', 'select', 'date'])

export function parseQABank(markdown: string): QAEntry[] {
  const entries: QAEntry[] = []
  // Split on ## headings
  const blocks = markdown.split(/^## /m).slice(1)
  for (const block of blocks) {
    const lines = block.split('\n')
    const question = lines[0]?.trim()
    if (!question) continue
    const body = lines.slice(1).join('\n')
    try {
      entries.push(parseEntry(question, body))
    } catch (e) {
      console.warn(`[JFF] qa-parser: skipping malformed entry "${question}":`, e)
    }
  }
  return entries
}

function parseEntry(question: string, body: string): QAEntry {
  const fields: Record<string, string> = {}
  let inAnswer = false
  const answerLines: string[] = []

  for (const line of body.split('\n')) {
    if (inAnswer) {
      // Collect indented answer lines (YAML block scalar style)
      if (/^\s{2,}/.test(line) || line.trim() === '') {
        answerLines.push(line.trim())
      } else if (/^- \w+:/.test(line)) {
        inAnswer = false
        const m = line.match(/^- (\w[\w\s]*):\s*(.*)$/)
        if (m) fields[m[1].toLowerCase()] = m[2].trim()
      }
      continue
    }
    const m = line.match(/^- (\w[\w\s]*):\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'answer') {
      if (val === '|') {
        inAnswer = true
      } else {
        fields['answer'] = val
      }
    } else {
      fields[key] = val
    }
  }

  if (answerLines.length) {
    fields['answer'] = answerLines.join('\n').trim()
  }

  const rawType = fields['type'] ?? 'text'
  const type: QAType = VALID_TYPES.has(rawType as QAType) ? (rawType as QAType) : 'text'
  const tags = (fields['tags'] ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
  const answer = fields['answer'] ?? ''
  if (!answer) throw new Error('Missing answer field')

  return { question, type, tags, answer }
}

export function qaEntryToMarkdown(entry: QAEntry): string {
  const lines = [
    `## ${entry.question}`,
    `- type: ${entry.type}`,
    `- tags: ${entry.tags.join(', ')}`,
  ]
  if (entry.answer.includes('\n')) {
    lines.push('- answer: |')
    for (const l of entry.answer.split('\n')) lines.push(`  ${l}`)
  } else {
    lines.push(`- answer: ${entry.answer}`)
  }
  return lines.join('\n')
}

/** Safely appends a new entry to the end of the bank. Never overwrites. */
export function appendQAEntry(bankMarkdown: string, entry: QAEntry): string {
  const suffix = qaEntryToMarkdown(entry)
  const trimmed = bankMarkdown.trimEnd()
  return trimmed ? `${trimmed}\n\n${suffix}\n` : `# Q&A Bank\n\n${suffix}\n`
}
