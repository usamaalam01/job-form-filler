import type { MappingResult, WriteResult } from '@shared/types'
import { getFieldElement } from './detector'

// Native setter — bypasses React/Vue/Angular's synthetic value interception
const nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
const nativeTextareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

function dispatchInputChange(el: HTMLElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// ─── Writers ──────────────────────────────────────────────────────────────────

export function writeTextInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const setter = el instanceof HTMLTextAreaElement ? nativeTextareaSetter : nativeInputSetter
  if (setter) {
    setter.call(el, value)
  } else {
    el.value = value
  }
  el.dispatchEvent(new Event('focus', { bubbles: true }))
  dispatchInputChange(el)
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

export function writeSelect(el: HTMLSelectElement, value: string): void {
  const normValue = value.toLowerCase()
  for (const option of el.options) {
    if (option.text.toLowerCase() === normValue || option.value.toLowerCase() === normValue) {
      el.value = option.value
      dispatchInputChange(el)
      return
    }
  }
  // Partial match fallback
  for (const option of el.options) {
    if (option.text.toLowerCase().includes(normValue) || normValue.includes(option.text.toLowerCase())) {
      el.value = option.value
      dispatchInputChange(el)
      return
    }
  }
}

export function writeCheckbox(el: HTMLInputElement, value: boolean): void {
  if (el.checked !== value) {
    el.checked = value
    el.dispatchEvent(new Event('click', { bubbles: true }))
    dispatchInputChange(el)
  }
}

export function writeRadioGroup(name: string, value: string, root: Document = document): void {
  const radios = root.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(name)}"]`)
  const normValue = value.toLowerCase()
  for (const radio of radios) {
    const label = (radio.labels?.[0]?.textContent ?? radio.value).toLowerCase()
    if (label === normValue || radio.value.toLowerCase() === normValue || label.includes(normValue)) {
      radio.checked = true
      radio.dispatchEvent(new Event('click', { bubbles: true }))
      dispatchInputChange(radio)
      return
    }
  }
}

// ─── MutationObserver-based option list wait ─────────────────────────────────

function waitForOptions(
  optionSelector: string,
  timeoutMs = 1500,
): Promise<Element[]> {
  return new Promise(resolve => {
    // Check immediately
    const existing = Array.from(document.querySelectorAll(optionSelector))
    if (existing.length > 0) { resolve(existing); return }

    const timer = setTimeout(() => {
      observer.disconnect()
      resolve([])
    }, timeoutMs)

    const observer = new MutationObserver(() => {
      const opts = Array.from(document.querySelectorAll(optionSelector))
      if (opts.length > 0) {
        clearTimeout(timer)
        observer.disconnect()
        resolve(opts)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

export async function writeCombobox(el: HTMLElement, value: string): Promise<boolean> {
  el.dispatchEvent(new Event('focus', { bubbles: true }))

  // Set value to trigger dropdown
  if (el instanceof HTMLInputElement) {
    writeTextInput(el, value)
  } else {
    el.textContent = value
    dispatchInputChange(el)
  }

  // MutationObserver-based wait (up to 1500ms) — replaces fixed polling
  const optionSelector = '[role="option"], [role="listitem"], [aria-selected], li[data-value]'
  const options = await waitForOptions(optionSelector, 1500)

  if (options.length > 0) {
    const normValue = value.toLowerCase()
    for (const option of options) {
      if ((option.textContent ?? '').toLowerCase().includes(normValue)) {
        ;(option as HTMLElement).click()
        return true
      }
    }
  }

  // Fallback: type each character with KeyboardEvent
  for (const char of value) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))
    await new Promise(r => setTimeout(r, 20))
  }
  return false
}

// ─── Date picker hardening ────────────────────────────────────────────────────

export async function writeDatePicker(el: HTMLInputElement, value: string): Promise<WriteResult> {
  const fieldId = el.id || el.name || 'date-field'

  // Step 1: try native setter (works for standard date/month inputs)
  if (!el.readOnly) {
    writeTextInput(el, value)
    if ((el.value === value) || el.value) {
      return { fieldId, ok: true }
    }
  }

  // Step 2: readonly — click to open picker, then navigate via keyboard
  if (el.readOnly) {
    el.click()
    el.focus()
    await new Promise(r => setTimeout(r, 200))

    // Try arrow keys to set a rough date, then type
    const match = value.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/)
    if (match) {
      const [, , month] = match
      // Type the month first (numeric)
      for (const char of month) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }))
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))
        await new Promise(r => setTimeout(r, 30))
      }
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { fieldId, ok: true, note: 'date-picker-keyboard' }
    }
  }

  // Step 3: Workday-style — handled by the Workday adapter writeField override

  // Step 4: flag as unfillable
  return { fieldId, ok: false, note: 'date-picker-unfillable' }
}

// ─── Main write dispatcher ────────────────────────────────────────────────────

export async function writeValues(results: MappingResult[]): Promise<WriteResult[]> {
  const writeResults: WriteResult[] = []

  for (const result of results) {
    if (!result.include || result.value === null) {
      writeResults.push({ fieldId: result.field.fieldId, ok: true, note: 'skipped' })
      continue
    }

    // Re-fetch element at write time (EC-14)
    const el = getFieldElement(result.field.fieldId)
    if (!el) {
      writeResults.push({ fieldId: result.field.fieldId, ok: false, note: 'element-gone' })
      continue
    }

    // Skip disabled fields
    if ((el as HTMLInputElement).disabled) {
      writeResults.push({ fieldId: result.field.fieldId, ok: true, note: 'skipped-readonly' })
      continue
    }

    // Date/month fields: use hardened date picker strategy (handles readonly pickers)
    const fieldType = result.field.type
    if ((fieldType === 'date' || fieldType === 'month') && (el as HTMLInputElement).readOnly) {
      const r = await writeDatePicker(el as HTMLInputElement, String(result.value))
      writeResults.push(r)
      continue
    }

    // Enforce maxLength — truncate if needed
    let value = String(result.value)
    let note = result.note
    const maxLength = (el as HTMLInputElement).maxLength
    if (maxLength > 0 && value.length > maxLength) {
      value = value.slice(0, maxLength)
      note = 'truncated'
    }

    try {
      const type = result.field.type

      if (type === 'select') {
        writeSelect(el as HTMLSelectElement, value)
      } else if (type === 'checkbox') {
        const boolVal = value === 'true' || value === 'yes' || value === '1'
        writeCheckbox(el as HTMLInputElement, typeof result.value === 'boolean' ? result.value : boolVal)
      } else if (type === 'radio') {
        const name = (el as HTMLInputElement).name
        if (name) writeRadioGroup(name, value)
      } else if (type === 'combobox') {
        await writeCombobox(el, value)
      } else if (type === 'contenteditable') {
        el.textContent = value
        dispatchInputChange(el)
      } else {
        // text, email, tel, url, number, date, month, textarea
        writeTextInput(el as HTMLInputElement, value)
      }

      writeResults.push({ fieldId: result.field.fieldId, ok: true, note })
    } catch (err) {
      writeResults.push({
        fieldId: result.field.fieldId,
        ok: false,
        note: err instanceof Error ? err.message : 'write-error',
      })
    }
  }

  return writeResults
}
