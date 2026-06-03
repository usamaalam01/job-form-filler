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

export async function writeCombobox(el: HTMLElement, value: string): Promise<boolean> {
  // Phase 1: focus + set value and hope the combobox reacts
  el.dispatchEvent(new Event('focus', { bubbles: true }))
  if (el instanceof HTMLInputElement) {
    writeTextInput(el, value)
  } else {
    el.textContent = value
    dispatchInputChange(el)
  }

  // Wait for dropdown to appear (up to 500ms)
  const optionSelector = '[role="option"], [role="listitem"], li'
  let options: NodeListOf<Element> | null = null
  const deadline = Date.now() + 500
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50))
    options = document.querySelectorAll(optionSelector)
    if (options.length > 0) break
  }

  if (options && options.length > 0) {
    const normValue = value.toLowerCase()
    for (const option of options) {
      if ((option.textContent ?? '').toLowerCase().includes(normValue)) {
        ;(option as HTMLElement).click()
        return true
      }
    }
  }

  // Fallback: type each character
  for (const char of value) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))
    await new Promise(r => setTimeout(r, 20))
  }
  return false
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

    // Skip disabled / readonly
    if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) {
      writeResults.push({ fieldId: result.field.fieldId, ok: true, note: 'skipped-readonly' })
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
