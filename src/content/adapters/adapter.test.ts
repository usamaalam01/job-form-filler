import { describe, it, expect, beforeEach } from 'vitest'
import { registerAdapter, selectAdapter, getRegisteredAdapters } from './adapter'
import type { ATSAdapter } from './adapter'

function makeAdapter(id: string, urlPattern: RegExp): ATSAdapter {
  return {
    id,
    name: id,
    matches: (url) => urlPattern.test(url),
  }
}

describe('adapter registry', () => {
  beforeEach(() => {
    // Clear registry between tests by re-importing is not possible,
    // so we test via the public API with unique IDs
  })

  it('selectAdapter returns correct adapter for Workday URL', () => {
    const adapter = makeAdapter('workday-test', /myworkdayjobs\.com/i)
    registerAdapter(adapter)
    const result = selectAdapter('https://acme.myworkdayjobs.com/apply', document)
    expect(result?.id).toBe('workday-test')
  })

  it('selectAdapter returns correct adapter for Greenhouse URL', () => {
    const adapter = makeAdapter('greenhouse-test', /boards\.greenhouse\.io/i)
    registerAdapter(adapter)
    const result = selectAdapter('https://boards.greenhouse.io/acme/jobs/123', document)
    expect(result?.id).toBe('greenhouse-test')
  })

  it('selectAdapter returns null for unknown URL', () => {
    const result = selectAdapter('https://completely-unknown-ats.example.com/apply', document)
    expect(result).toBeNull()
  })

  it('getRegisteredAdapters returns all registered adapters', () => {
    const before = getRegisteredAdapters().length
    registerAdapter(makeAdapter('extra-test', /extra-test\.com/))
    expect(getRegisteredAdapters().length).toBe(before + 1)
  })

  it('adapter matches() receives url and document', () => {
    let receivedUrl = ''
    const adapter: ATSAdapter = {
      id: 'spy-test',
      name: 'Spy',
      matches: (url, _doc) => { receivedUrl = url; return false },
    }
    registerAdapter(adapter)
    selectAdapter('https://spy-test.example.com/apply', document)
    expect(receivedUrl).toBe('https://spy-test.example.com/apply')
  })
})
