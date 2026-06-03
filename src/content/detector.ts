import type { DetectedField, FieldType } from '@shared/types'

// In-memory map maintained for the life of a detect→apply cycle
const fieldMap = new Map<string, HTMLElement>()

export function getFieldElement(fieldId: string): HTMLElement | undefined {
  return fieldMap.get(fieldId)
}

export function clearFieldMap(): void {
  fieldMap.clear()
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function detectFields(root: Document | ShadowRoot = document): DetectedField[] {
  fieldMap.clear()
  const fields: DetectedField[] = []
  scanRoot(root, fields, 0, '')
  return fields
}

// ─── Core scanner ─────────────────────────────────────────────────────────────

function scanRoot(
  root: Document | ShadowRoot,
  out: DetectedField[],
  startIndex: number,
  idPrefix: string,
): number {
  const doc = root instanceof Document ? root : root.ownerDocument ?? document
  let index = startIndex

  const SELECTOR = [
    'input:not([type=hidden]):not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[contenteditable="true"]',
    '[role="combobox"]:not([disabled])',
    '[role="listbox"]:not([disabled])',
  ].join(', ')

  const elements = root.querySelectorAll<HTMLElement>(SELECTOR)

  for (const el of elements) {
    if (isHoneypot(el)) continue

    const label = resolveLabel(el, root)
    const fieldId = `${idPrefix}f_${index}_${slugify(label)}`
    const type = detectType(el)
    const options = type === 'select' ? getSelectOptions(el as HTMLSelectElement) :
                    type === 'radio'  ? getRadioOptions(el, root)               : undefined

    const field: DetectedField = {
      fieldId,
      selector: buildSelector(el),
      label,
      name: (el as HTMLInputElement).name || undefined,
      id: el.id || undefined,
      autocomplete: (el as HTMLInputElement).autocomplete || undefined,
      type,
      options,
      required: (el as HTMLInputElement).required ?? el.getAttribute('aria-required') === 'true',
      group: detectGroup(el),
      maxLength: (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : undefined,
      isUpload: type === 'file',
      uploadKind: type === 'file' ? classifyUpload(el) : undefined,
    }

    fieldMap.set(fieldId, el)
    out.push(field)
    index++
  }

  // Traverse open shadow roots
  const all = root.querySelectorAll('*')
  for (const el of all) {
    const shadow = (el as HTMLElement).shadowRoot
    if (!shadow) continue
    index = scanRoot(shadow, out, index, `${idPrefix}shadow_`)
  }

  // Same-origin iframes
  const iframes = root.querySelectorAll('iframe')
  let iframeIdx = 0
  for (const iframe of iframes) {
    try {
      const iDoc = iframe.contentDocument
      if (iDoc) {
        index = scanRoot(iDoc, out, index, `${idPrefix}iframe${iframeIdx}_`)
      }
    } catch {
      // Cross-origin — emit a single unfillable placeholder
      const placeholder: DetectedField = {
        fieldId: `${idPrefix}xorigin_iframe_${iframeIdx}`,
        label: 'cross-origin iframe — cannot fill',
        type: 'unknown',
        required: false,
      }
      out.push(placeholder)
    }
    iframeIdx++
    void doc // suppress unused variable warning
  }

  return index
}

// Safe ID escaping — CSS.escape is available in browsers but not all jsdom versions
function escapeId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof (CSS as { escape?: unknown }).escape === 'function') {
    return CSS.escape(id)
  }
  return id.replace(/[^\w-]/g, '\\$&')
}

// ─── Label resolution (priority order from SPEC §11.1) ───────────────────────

export function resolveLabel(el: HTMLElement, root: Document | ShadowRoot = document): string {
  // 1. <label for="id">
  if (el.id) {
    const label = root.querySelector<HTMLLabelElement>(`label[for="${escapeId(el.id)}"]`)
    if (label) return label.textContent?.trim() ?? ''
  }
  // 2. Wrapping <label>
  const wrappingLabel = el.closest('label')
  if (wrappingLabel) {
    const text = wrappingLabel.textContent?.trim() ?? ''
    const elText = el.textContent?.trim() ?? ''
    return text.replace(elText, '').trim() || text
  }
  // 3. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const labelEl = root.querySelector(`#${escapeId(labelledBy)}`)
    if (labelEl) return labelEl.textContent?.trim() ?? ''
  }
  // 4. aria-label
  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return ariaLabel.trim()
  // 5. Preceding text node / sibling text
  const preceding = precedingText(el)
  if (preceding) return preceding
  // 6. placeholder
  const ph = (el as HTMLInputElement).placeholder
  if (ph) return ph.trim()
  // 7. name / id de-camelCased
  const nameOrId = (el as HTMLInputElement).name || el.id
  if (nameOrId) return deCamelCase(nameOrId)
  return ''
}

function precedingText(el: HTMLElement): string {
  let node: Node | null = el.previousSibling
  while (node) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      return node.textContent.trim()
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const text = (node as HTMLElement).textContent?.trim()
      if (text) return text
      break
    }
    node = node.previousSibling
  }
  // Try parent's preceding sibling (e.g. label in a div above the input div)
  const parent = el.parentElement
  if (parent) {
    let sib: Element | null = parent.previousElementSibling
    while (sib) {
      const text = sib.textContent?.trim()
      if (text && !sib.querySelector('input,select,textarea')) return text
      sib = sib.previousElementSibling
    }
  }
  return ''
}

// ─── fieldId slug ─────────────────────────────────────────────────────────────

export function generateFieldId(el: HTMLElement, index: number, prefix = ''): string {
  const label = resolveLabel(el)
  return `${prefix}f_${index}_${slugify(label)}`
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'field'
}

// ─── Type detection ───────────────────────────────────────────────────────────

function detectType(el: HTMLElement): FieldType {
  if (el.tagName === 'SELECT') return 'select'
  if (el.tagName === 'TEXTAREA') return 'textarea'
  if (el.getAttribute('contenteditable') === 'true') return 'contenteditable'
  if (el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'listbox') return 'combobox'
  const inputType = ((el as HTMLInputElement).type || 'text').toLowerCase()
  const typeMap: Record<string, FieldType> = {
    text: 'text', email: 'email', tel: 'tel', url: 'url',
    number: 'number', date: 'date', month: 'month',
    checkbox: 'checkbox', radio: 'radio', file: 'file',
  }
  return typeMap[inputType] ?? 'text'
}

// ─── Honeypot detection ───────────────────────────────────────────────────────

function isHoneypot(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true
  if (el.getAttribute('tabindex') === '-1' && !isVisible(el)) return true
  const style = window.getComputedStyle?.(el)
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden') return true
    if (parseFloat(style.opacity) === 0) return true
    if (parseFloat(style.width) < 1 && parseFloat(style.height) < 1) return true
  }
  return false
}

function isVisible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)
}

// ─── Group detection ──────────────────────────────────────────────────────────

const GROUP_PATTERNS = /experience|education|work|employment|job|school|university|certification|project/i

function detectGroup(el: HTMLElement): string | undefined {
  let cur: HTMLElement | null = el.parentElement
  let depth = 0
  while (cur && depth < 8) {
    // Check for headings
    const heading = cur.querySelector('h1,h2,h3,h4,legend,label')
    if (heading && GROUP_PATTERNS.test(heading.textContent ?? '')) {
      return heading.textContent?.trim().slice(0, 40)
    }
    // Check element's own text if it's a fieldset/section
    if ((cur.tagName === 'FIELDSET' || cur.tagName === 'SECTION') && GROUP_PATTERNS.test(cur.textContent ?? '')) {
      const legend = cur.querySelector('legend')
      if (legend) return legend.textContent?.trim().slice(0, 40)
    }
    cur = cur.parentElement
    depth++
  }
  return undefined
}

// ─── Upload classification ────────────────────────────────────────────────────

function classifyUpload(el: HTMLElement): 'resume' | 'cover-letter' | 'other' {
  const context = (el.getAttribute('aria-label') ?? '') +
    (el.getAttribute('name') ?? '') +
    (el.closest('label')?.textContent ?? '') +
    (el.parentElement?.textContent ?? '')
  if (/resume|cv\b/i.test(context)) return 'resume'
  if (/cover.?letter/i.test(context)) return 'cover-letter'
  return 'other'
}

// ─── Select options ───────────────────────────────────────────────────────────

function getSelectOptions(el: HTMLSelectElement): string[] {
  return Array.from(el.options).map(o => o.text.trim()).filter(Boolean)
}

function getRadioOptions(el: HTMLElement, root: Document | ShadowRoot): string[] {
  const name = (el as HTMLInputElement).name
  if (!name) return []
  const radios = root.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${escapeId(name)}"]`)
  return Array.from(radios).map(r => resolveLabel(r, root)).filter(Boolean)
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

function buildSelector(el: HTMLElement): string {
  if (el.id) return `#${escapeId(el.id)}`
  if ((el as HTMLInputElement).name) return `[name="${(el as HTMLInputElement).name}"]`
  return el.tagName.toLowerCase()
}

function deCamelCase(str: string): string {
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}
