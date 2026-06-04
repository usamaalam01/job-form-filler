import type { ATSAdapter } from './adapter'

export const ICIMSAdapter: ATSAdapter = {
  id: 'icims',
  name: 'iCIMS',

  matches: (url) => /\.icims\.com/i.test(url),

  resolveLabel: (el, generic) => {
    // iCIMS labels are in <td class="iCIMS_TableCell_Label"> preceding the input cell
    const cell = el.closest('td')
    if (cell) {
      const row = cell.closest('tr')
      if (row) {
        const labelCell = row.querySelector<HTMLElement>('.iCIMS_TableCell_Label, td:first-child label')
        if (labelCell) return labelCell.textContent?.trim() ?? generic()
      }
    }
    // iCIMS also uses fieldsets with legends
    const fieldset = el.closest('fieldset')
    if (fieldset) {
      const legend = fieldset.querySelector('legend')
      if (legend) return legend.textContent?.trim() ?? generic()
    }
    return generic()
  },
}
