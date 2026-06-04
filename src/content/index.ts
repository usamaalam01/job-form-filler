import { detectFields } from './detector'
import { writeValues } from './writer'
import './adapters/index' // registers all ATS adapters
import type { MappingResult } from '@shared/types'

// ─── "Add another" repeatable block helper ────────────────────────────────────

function addRepeatableBlock(buttonSelector: string): boolean {
  const btn = document.querySelector<HTMLElement>(buttonSelector)
  if (!btn) return false
  btn.click()
  return true
}

// ─── Window API ───────────────────────────────────────────────────────────────

interface JFFWindow {
  __jff_detectFields?: () => ReturnType<typeof detectFields>
  __jff_writeValues?: (results: MappingResult[]) => ReturnType<typeof writeValues>
  __jff_addRepeatableBlock?: (selector: string) => boolean
}

declare const window: Window & JFFWindow

window.__jff_detectFields = detectFields
window.__jff_writeValues = writeValues
window.__jff_addRepeatableBlock = addRepeatableBlock

console.log('[JFF] Content script ready.')
