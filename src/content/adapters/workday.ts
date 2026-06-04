/**
 * Workday ATS adapter.
 *
 * Workday-specific field IDs (data-automation-id values, non-exhaustive):
 *   legalNameSection--firstName          First name
 *   legalNameSection--lastName           Last name
 *   email                                Email
 *   phone-number                         Phone
 *   addressSection--city                 City
 *   addressSection--countryRegion        Country
 *   linkedin-url                         LinkedIn
 *   resume                               Resume upload
 *   cover-letter                         Cover letter upload
 *   workExperience--startDate            Work start date
 *   workExperience--endDate              Work end date
 *   education--startDate                 Education start date
 *   education--endDate                   Education end date
 *   jobTitle                             Job title
 *   companyName                          Company name
 *   degree                               Degree
 *   gpa                                  GPA
 */

import type { ATSAdapter } from './adapter'
import type { DetectedField, MappingResult } from '@shared/types'
import { detectFields as genericDetectFields } from '../detector'

const WORKDAY_URL = /(?:myworkdayjobs\.com|workday\.com\/.*\/d\/jobs)/i

// ─── MutationObserver-based DOM settle ───────────────────────────────────────

function waitForDOMSettle(doc: Document, timeoutMs = 2000): Promise<void> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { observer.disconnect(); resolve() }, 300)
    }
    const observer = new MutationObserver(reset)
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true })
    reset()
    setTimeout(() => { observer.disconnect(); resolve() }, timeoutMs)
  })
}

// ─── Date field keyboard simulation ──────────────────────────────────────────

async function writeWorkdayDate(el: HTMLElement, value: string): Promise<boolean> {
  // Workday date inputs have data-automation-id ending in "Date"
  // They accept keyboard input into separate month/day/year segments
  // value format: YYYY-MM or YYYY-MM-DD
  const match = value.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/)
  if (!match) return false

  const [, year, month, day] = match
  el.click()
  el.focus()

  await new Promise(r => setTimeout(r, 100))

  // Workday date picker: type MM then DD (optional) then YYYY
  const parts = day ? [month, day, year] : [month, '01', year]
  for (const part of parts) {
    for (const char of part) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Digit${char}`, bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Digit${char}`, bubbles: true }))
      await new Promise(r => setTimeout(r, 30))
    }
    // Tab to next segment
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await new Promise(r => setTimeout(r, 30))
  }

  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

// ─── Workday adapter ──────────────────────────────────────────────────────────

export const WorkdayAdapter: ATSAdapter = {
  id: 'workday',
  name: 'Workday',

  matches: (url) => WORKDAY_URL.test(url),

  detectFields: (doc: Document): DetectedField[] => {
    // Use generic detector first, then re-key by data-automation-id.
    // DOM settling (MutationObserver) is called via beforeWrite as a pre-step.
    const fields = genericDetectFields(doc)

    // Re-key fields that have data-automation-id — use it as stable fieldId
    return fields.map(f => {
      const candidates = f.id
        ? [doc.querySelector<HTMLElement>(`[data-automation-id="${f.id}"]`)]
        : []
      const el = candidates[0] ?? (f.name ? doc.querySelector<HTMLElement>(`[data-automation-id="${f.name}"]`) : null)
      if (!el) return f
      const automationId = el.getAttribute('data-automation-id')
      if (!automationId) return f
      return { ...f, fieldId: `wd_${automationId}`, selector: `[data-automation-id="${automationId}"]` }
    })
  },

  resolveLabel: (el, generic) => {
    // Workday labels live in a sibling/parent with data-automation-id="*-label"
    const automationId = el.getAttribute('data-automation-id')
    if (automationId) {
      const label = el.closest('[data-automation-id]')
        ?.parentElement
        ?.querySelector<HTMLElement>(`[data-automation-id="${automationId}-label"]`)
      if (label) return label.textContent?.trim() ?? generic()
    }
    return generic()
  },

  beforeWrite: async (results: MappingResult[]) => {
    // Scroll to trigger lazy field loading, then wait for DOM to settle
    const form = document.querySelector('form')
    if (form) {
      form.scrollTo({ top: form.scrollHeight, behavior: 'smooth' })
      await new Promise(r => setTimeout(r, 500))
      form.scrollTo({ top: 0, behavior: 'smooth' })
      await new Promise(r => setTimeout(r, 300))
    }
    // Wait for any remaining MutationObserver-triggered renders
    await waitForDOMSettle(document)
    void results
  },

  writeField: async (fieldId, result, generic) => {
    const el = document.querySelector<HTMLElement>(`[data-automation-id="${fieldId.replace('wd_', '')}"]`)
    if (!el) return generic()

    const isDateField = fieldId.includes('Date') || fieldId.includes('date')
    const isReadOnly = (el as HTMLInputElement).readOnly || el.getAttribute('readonly') !== null

    if (isDateField && isReadOnly && result.value) {
      const written = await writeWorkdayDate(el, String(result.value))
      if (written) return { fieldId, ok: true }
    }

    return generic()
  },

  addRepeatableBlock: async (groupName, doc) => {
    // Workday "Add" buttons: [data-automation-id="add-workExperience"] etc.
    const slug = groupName.toLowerCase().replace(/\s+/g, '')
    const selectors = [
      `[data-automation-id="add-${slug}"]`,
      `[data-automation-id^="add"][data-automation-id*="${slug}"]`,
      `button[aria-label*="${groupName}" i]`,
    ]

    for (const sel of selectors) {
      const btn = doc.querySelector<HTMLElement>(sel)
      if (btn) {
        const countBefore = doc.querySelectorAll(`[data-automation-id*="${slug}Row"]`).length
        btn.click()
        await new Promise(r => setTimeout(r, 800))
        const countAfter = doc.querySelectorAll(`[data-automation-id*="${slug}Row"]`).length
        return countAfter > countBefore
      }
    }
    return false
  },

  getNextStepSelector: (doc) => {
    const candidates = Array.from(doc.querySelectorAll<HTMLElement>('button, [role=button]'))
    const next = candidates.find(el => /^(next|continue|proceed|save & continue)/i.test(el.textContent?.trim() ?? ''))
    return next ? (next.id ? `#${next.id}` : null) : null
  },
}

// Workday adapter also needs to be a synchronous detectFields for the content
// script (executeScript cannot await top-level). Expose a sync wrapper:
export function detectFieldsSync(doc: Document): DetectedField[] {
  return genericDetectFields(doc)
}
