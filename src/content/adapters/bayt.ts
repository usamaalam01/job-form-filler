import type { ATSAdapter } from './adapter'

export const BaytAdapter: ATSAdapter = {
  id: 'bayt',
  name: 'Bayt',

  // Bayt.com — Middle East job platform, English UI in v1 (SPEC N6)
  matches: (url) => /\.bayt\.com/i.test(url),

  resolveLabel: (el, generic) => {
    // Bayt uses Bootstrap-style form-groups with labels above inputs
    const formGroup = el.closest('.form-group, .field-row, .application-field')
    if (formGroup) {
      const label = formGroup.querySelector<HTMLElement>('label')
      if (label && label !== el) return label.textContent?.trim() ?? generic()
    }
    // Bayt also uses data-label attribute on some fields
    const dataLabel = el.getAttribute('data-label') ?? el.getAttribute('data-placeholder')
    if (dataLabel) return dataLabel.trim()
    return generic()
  },
}
