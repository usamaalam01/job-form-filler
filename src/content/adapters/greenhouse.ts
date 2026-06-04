import type { ATSAdapter } from './adapter'

export const GreenhouseAdapter: ATSAdapter = {
  id: 'greenhouse',
  name: 'Greenhouse',

  matches: (url) => /boards\.greenhouse\.io|greenhouse\.io\/[\w-]+\/jobs/i.test(url),

  resolveLabel: (el, generic) => {
    // Greenhouse wraps labels in <label class="field__label"> above the input
    const fieldContainer = el.closest('.field')
    if (fieldContainer) {
      const label = fieldContainer.querySelector<HTMLElement>('.field__label, label')
      if (label) return label.textContent?.trim() ?? generic()
    }
    return generic()
  },
}
