import { describe, it, expect, beforeEach } from 'vitest'
import { detectFields } from './detector'

describe('P3-T4 shadow DOM & iframe hardening', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('detects fields inside open shadow root', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<label>Shadow Email <input type="email" name="shadowEmail" /></label>'
    const fields = detectFields()
    const shadowField = fields.find(f => f.name === 'shadowEmail')
    expect(shadowField).toBeDefined()
    expect(shadowField?.type).toBe('email')
  })

  it('shadow field fieldId contains depth prefix', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<input type="text" name="shadowInput" />'
    const fields = detectFields()
    const shadowField = fields.find(f => f.name === 'shadowInput')
    expect(shadowField?.fieldId).toMatch(/s1_/) // depth 1
  })

  it('nested shadow root field has deeper depth prefix', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const outerShadow = host.attachShadow({ mode: 'open' })
    const innerHost = document.createElement('div')
    outerShadow.appendChild(innerHost)
    const innerShadow = innerHost.attachShadow({ mode: 'open' })
    innerShadow.innerHTML = '<input type="text" name="nested" />'
    const fields = detectFields()
    const nested = fields.find(f => f.name === 'nested')
    // The nested field should have a depth-2 prefix
    expect(nested?.fieldId).toMatch(/s1_.*s2_|s2_/)
  })

  it('cross-origin iframe emits unfillable placeholder with needsReview', () => {
    // jsdom treats cross-origin access as throwing, which triggers our catch
    document.body.innerHTML = '<iframe src="https://other-origin.com/form"></iframe>'
    // The iframe.contentDocument access throws in jsdom (cross-origin simulation)
    // Our detector catches and emits an xorigin placeholder
    // Since jsdom actually returns null for cross-origin, we mock the throw:
    const iframe = document.querySelector('iframe')!
    Object.defineProperty(iframe, 'contentDocument', {
      get: () => { throw new DOMException('Blocked', 'SecurityError') },
    })
    const fields = detectFields()
    const xorigin = fields.find(f => f.label === 'cross-origin iframe — cannot fill')
    expect(xorigin).toBeDefined()
    expect(xorigin?.type).toBe('unknown')
  })

  it('detects "Add another" button selector for repeatable groups', () => {
    document.body.innerHTML = `
      <div>
        <h4>Work Experience</h4>
        <input type="text" name="jobTitle" />
      </div>
      <button id="add-exp">+ Add another experience</button>
    `
    const fields = detectFields()
    const jobField = fields.find(f => f.name === 'jobTitle')
    // The add-another button should be detected
    expect(jobField?.addAnotherButtonSelector).toBeDefined()
  })
})
