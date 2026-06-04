import type { ATSAdapter } from './adapter'
import type { DetectedField } from '@shared/types'
import { detectFields as genericDetectFields } from '../detector'

export const TaleoAdapter: ATSAdapter = {
  id: 'taleo',
  name: 'Taleo',

  matches: (url) => /\.taleo\.net|tbe\.taleo\.net/i.test(url),

  detectFields: (doc: Document): DetectedField[] => {
    // Taleo uses heavy JS that sometimes renders inside nested frames.
    // The generic detector handles the main document; this override ensures
    // Taleo-specific hidden fields (type=text but visually hidden via CSS class)
    // are excluded.
    const fields = genericDetectFields(doc)
    return fields.filter(f => {
      const el = f.id ? doc.getElementById(f.id) : null
      if (!el) return true
      // Skip Taleo internal control fields
      const cls = el.className ?? ''
      return !cls.includes('ftlHidden') && !cls.includes('taleo-hidden')
    })
  },

  resolveLabel: (el, generic) => {
    // Taleo uses <span class="req-field-label"> or <label> in a preceding row
    const row = el.closest('tr')
    if (row) {
      const prevRow = row.previousElementSibling
      const label = prevRow?.querySelector('.req-field-label, .field-label, label')
      if (label) return label.textContent?.trim() ?? generic()
      // Same row label
      const sameRowLabel = row.querySelector('.req-field-label, label')
      if (sameRowLabel) return sameRowLabel.textContent?.trim() ?? generic()
    }
    return generic()
  },
}
