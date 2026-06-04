import type { DetectedField, MappingResult, WriteResult } from '@shared/types'

// ─── Adapter contract ─────────────────────────────────────────────────────────

export interface ATSAdapter {
  id: string
  name: string

  /** Return true if this adapter applies to the current page. */
  matches(url: string, doc: Document): boolean

  /**
   * Override full field detection for this ATS.
   * When absent, the generic detector runs.
   */
  detectFields?(doc: Document): DetectedField[]

  /**
   * Override label resolution for a specific element.
   * Receives a `generic` fallback — call it to get the generic resolved label.
   */
  resolveLabel?(el: HTMLElement, generic: () => string): string

  /**
   * Called before writeValues so the adapter can set up the page
   * (e.g. scroll, wait for lazy fields) before any writing begins.
   */
  beforeWrite?(results: MappingResult[]): Promise<void>

  /**
   * Override value writing for a specific field.
   * Receives a `generic` fallback — call it to use the standard writer.
   */
  writeField?(
    fieldId: string,
    result: MappingResult,
    generic: () => Promise<WriteResult>,
  ): Promise<WriteResult>

  /**
   * Click "Add another" to create a new repeatable block for `groupName`.
   * Returns true if a new block appeared, false if the click had no effect.
   */
  addRepeatableBlock?(groupName: string, doc: Document): Promise<boolean>

  /**
   * Return the selector for the "Next / Continue" button on wizard forms.
   * Used by the panel to prompt the user to advance.
   */
  getNextStepSelector?(doc: Document): string | null
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const registry: ATSAdapter[] = []

export function registerAdapter(adapter: ATSAdapter): void {
  registry.push(adapter)
}

export function selectAdapter(url: string, doc: Document): ATSAdapter | null {
  return registry.find(a => a.matches(url, doc)) ?? null
}

/** Returns all registered adapters (for display/testing). */
export function getRegisteredAdapters(): ATSAdapter[] {
  return [...registry]
}
