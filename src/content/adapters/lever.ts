import type { ATSAdapter } from './adapter'
import type { WriteResult } from '@shared/types'

export const LeverAdapter: ATSAdapter = {
  id: 'lever',
  name: 'Lever',

  matches: (url) => /jobs\.lever\.co/i.test(url),

  resolveLabel: (el, generic) => {
    // Lever uses <label class="application-label"> paired via for attribute
    // or wrapping pattern
    const forLabel = el.id
      ? document.querySelector<HTMLElement>(`label[for="${el.id}"]`)
      : null
    if (forLabel) return forLabel.textContent?.trim() ?? generic()

    const parent = el.closest('.application-field, .application-question')
    if (parent) {
      const label = parent.querySelector<HTMLElement>('label, .application-label')
      if (label) return label.textContent?.trim() ?? generic()
    }
    return generic()
  },

  writeField: async (fieldId, result, generic): Promise<WriteResult> => {
    // Lever uses React-Select for dropdowns — handled by generic combobox writer
    // but needs a longer settle time
    const el = document.getElementById(fieldId) ?? document.querySelector(`[name="${fieldId}"]`)
    if (el?.getAttribute('role') === 'combobox') {
      await new Promise(r => setTimeout(r, 200)) // allow React hydration
    }
    void result
    return generic()
  },
}
