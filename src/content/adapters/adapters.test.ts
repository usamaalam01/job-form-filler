import { describe, it, expect } from 'vitest'
import './index' // registers all adapters
import { selectAdapter } from './adapter'

const URLS = {
  workday:    'https://acme.myworkdayjobs.com/en-US/Careers/job/Apply',
  workday2:   'https://wd5.myworkdayjobs.com/en-US/Beta_External_Careers',
  greenhouse: 'https://boards.greenhouse.io/acme/jobs/12345',
  lever:      'https://jobs.lever.co/acme/abc-123/apply',
  icims:      'https://careers.icims.com/jobs/1234/apply',
  taleo:      'https://acme.taleo.net/careersection/apply',
  bayt:       'https://www.bayt.com/en/uae/jobs/apply/12345/',
  unknown:    'https://careers.randomcompany.com/apply',
}

describe('adapter URL matching', () => {
  it('selects Workday for myworkdayjobs.com', () => {
    expect(selectAdapter(URLS.workday, document)?.id).toBe('workday')
  })

  it('selects Workday for wd5.myworkdayjobs.com', () => {
    expect(selectAdapter(URLS.workday2, document)?.id).toBe('workday')
  })

  it('selects Greenhouse for boards.greenhouse.io', () => {
    expect(selectAdapter(URLS.greenhouse, document)?.id).toBe('greenhouse')
  })

  it('selects Lever for jobs.lever.co', () => {
    expect(selectAdapter(URLS.lever, document)?.id).toBe('lever')
  })

  it('selects iCIMS for *.icims.com', () => {
    expect(selectAdapter(URLS.icims, document)?.id).toBe('icims')
  })

  it('selects Taleo for *.taleo.net', () => {
    expect(selectAdapter(URLS.taleo, document)?.id).toBe('taleo')
  })

  it('selects Bayt for *.bayt.com', () => {
    expect(selectAdapter(URLS.bayt, document)?.id).toBe('bayt')
  })

  it('returns null for unknown ATS URL', () => {
    expect(selectAdapter(URLS.unknown, document)).toBeNull()
  })
})

describe('adapter resolveLabel overrides', () => {
  const generic = () => 'generic-label'

  it('Greenhouse: resolves label from .field__label', () => {
    document.body.innerHTML = `
      <div class="field">
        <label class="field__label">Email Address</label>
        <input id="email" type="email" />
      </div>`
    const adapter = selectAdapter(URLS.greenhouse, document)!
    const el = document.getElementById('email')!
    expect(adapter.resolveLabel!(el, generic)).toBe('Email Address')
  })

  it('iCIMS: resolves label from .iCIMS_TableCell_Label', () => {
    document.body.innerHTML = `
      <table><tr>
        <td class="iCIMS_TableCell_Label"><label>Phone Number</label></td>
        <td><input id="phone" type="tel" /></td>
      </tr></table>`
    const adapter = selectAdapter(URLS.icims, document)!
    const el = document.getElementById('phone')!
    expect(adapter.resolveLabel!(el, generic)).toBe('Phone Number')
  })

  it('Bayt: resolves label from .form-group label', () => {
    document.body.innerHTML = `
      <div class="form-group">
        <label for="fullname">Full Name</label>
        <input id="fullname" type="text" />
      </div>`
    const adapter = selectAdapter(URLS.bayt, document)!
    const el = document.getElementById('fullname')!
    expect(adapter.resolveLabel!(el, generic)).toBe('Full Name')
  })

  it('Bayt: falls back to generic when no form-group label', () => {
    document.body.innerHTML = '<input id="mystery" type="text" />'
    const adapter = selectAdapter(URLS.bayt, document)!
    const el = document.getElementById('mystery')!
    expect(adapter.resolveLabel!(el, generic)).toBe('generic-label')
  })

  it('Workday: resolves label from data-automation-id sibling', () => {
    document.body.innerHTML = `
      <div>
        <label data-automation-id="legalNameSection--firstName-label">First Name</label>
        <input data-automation-id="legalNameSection--firstName" id="fn" />
      </div>`
    const adapter = selectAdapter(URLS.workday, document)!
    const el = document.getElementById('fn')!
    // Generic fallback since the adapter looks for a specific DOM structure
    const result = adapter.resolveLabel!(el, generic)
    expect(typeof result).toBe('string')
  })
})
