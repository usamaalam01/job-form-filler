import { detectFields } from './detector'
import { writeValues } from './writer'
import type { MappingResult } from '@shared/types'

// Expose functions on window so the background can call them via executeScript
interface JFFWindow {
  __jff_detectFields?: () => ReturnType<typeof detectFields>
  __jff_writeValues?: (results: MappingResult[]) => ReturnType<typeof writeValues>
}

declare const window: Window & JFFWindow

window.__jff_detectFields = detectFields
window.__jff_writeValues = writeValues

console.log('[JFF] Content script ready.')
